// The HubSpot connection, read only: Pulse reads support tickets (subject, description, category) and the name of the company a ticket belongs to, so what customers write to support
// can be heard alongside everything else. Nothing is ever written to HubSpot, and agent notes, conversations and contact details are never read. It signs in with a HubSpot SERVICE KEY
// (Settings, Development, Keys, Service keys in HubSpot) holding only read scopes; the key's scopes are the real limit on what can be seen. Nothing here touches the database. `fetch` is
// passed in so tests can stand in for HubSpot.
export type HubspotFetch = (url: string, init?: RequestInit) => Promise<Response>
export type HubspotConfig = { token: string; portalId: string | null }
export type HsTicket = {
  id: string
  subject: string
  content: string
  category: string | null
  createdAt: string
  modified: string
  companyId: string | null
  companyName: string | null
  /** Where to open it in HubSpot; null when the account's portal id is not known. */
  url: string | null
}
export type TicketQuery = { since: string; categories: string[] | null }
export type HubspotClient = {
  /** Tickets changed since `since` (an ISO time), oldest change first, with the name of their company. */
  fetchTickets(q: TicketQuery): Promise<HsTicket[]>
  /** Whether the key works and can read tickets: one tiny read, so the Settings card can say so. */
  check(): Promise<void>
}

export class HubspotError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? hubspotProblem(code))
  }
}

export function hubspotProblem(code: string): string {
  switch (code) {
    case 'http_401':
      return 'HubSpot refused the key. Check that it is a current service key, copied whole.'
    case 'http_403':
      return 'The key is missing a permission. It needs crm.objects.tickets.read and crm.objects.companies.read.'
    case 'http_429':
      return 'HubSpot says it is being asked too often. It will be tried again.'
    case 'not_connected':
      return 'HubSpot is not connected yet.'
    default:
      return `HubSpot said: ${code}`
  }
}

const API = 'https://api.hubapi.com'
const PAGE = 100
const MAX_TICKETS = 1_000
const TICKET_PROPS = ['subject', 'content', 'hs_ticket_category', 'createdate', 'hs_lastmodifieddate']

/** Ticket text as plain words: tags dropped, entities unescaped, white space collapsed. */
export function plainTicketText(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li)>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** HubSpot keeps a category under an internal name (Product Issue is PRODUCT_ISSUE). Both the name as typed and that form are searched, so either works; a custom option with another internal name is matched when it is typed exactly. */
export const categoryValues = (typed: string): string[] => [...new Set([typed.trim(), typed.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '')])].filter(Boolean)
/** An internal category name as words for people: PRODUCT_ISSUE reads "Product issue". Anything not in that form is shown as it is. */
export const prettyCategory = (value: string): string => (/^[A-Z0-9_]+$/.test(value) ? value.toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : value)

export const cleanPortalId = (s: unknown): string | null => (typeof s === 'string' && /^\d{3,12}$/.test(s.trim()) ? s.trim() : null)

export function makeHubspot(cfg: HubspotConfig, fetchImpl: HubspotFetch = fetch): HubspotClient {
  // Every call is to the one HubSpot API host with the key as a bearer token. A failure is its HTTP status (HubSpot's own message is not passed on).
  async function call(path: string, body: unknown): Promise<Record<string, any>> {
    const res = await fetchImpl(`${API}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    })
    const out = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok) throw new HubspotError(`http_${res.status}`)
    return out
  }
  const ticketUrl = (id: string) => (cfg.portalId ? `https://app.hubspot.com/contacts/${cfg.portalId}/record/0-5/${id}` : null)
  return {
    async check() {
      await call('/crm/v3/objects/tickets/search', { filterGroups: [], properties: ['subject'], limit: 1 })
    },
    async fetchTickets(q) {
      const since = Date.parse(q.since)
      if (!Number.isFinite(since)) throw new HubspotError('bad_since')
      const filters: Record<string, unknown>[] = [{ propertyName: 'hs_lastmodifieddate', operator: 'GTE', value: String(since) }]
      if (q.categories?.length) filters.push({ propertyName: 'hs_ticket_category', operator: 'IN', values: [...new Set(q.categories.flatMap(categoryValues))] })
      const rows: Record<string, any>[] = []
      let after: string | undefined
      for (let page = 0; page < 10 && rows.length < MAX_TICKETS; page++) {
        const out = await call('/crm/v3/objects/tickets/search', { filterGroups: [{ filters }], properties: TICKET_PROPS, sorts: [{ propertyName: 'hs_lastmodifieddate', direction: 'ASCENDING' }], limit: PAGE, ...(after ? { after } : {}) })
        rows.push(...((out.results ?? []) as Record<string, any>[]))
        after = typeof out.paging?.next?.after === 'string' ? out.paging.next.after : undefined
        if (!after) break
      }
      const tickets = rows.slice(0, MAX_TICKETS).filter((r) => r.id)
      // The company each ticket belongs to: its first associated company, then that company's name. Two small batch reads, and only the name is asked for.
      const companyOf = new Map<string, string>()
      if (tickets.length) {
        for (let i = 0; i < tickets.length; i += 100) {
          const out = await call('/crm/v4/associations/tickets/companies/batch/read', { inputs: tickets.slice(i, i + 100).map((t) => ({ id: String(t.id) })) })
          for (const r of (out.results ?? []) as Record<string, any>[]) {
            const to = r.to?.[0]?.toObjectId
            if (r.from?.id !== undefined && to !== undefined) companyOf.set(String(r.from.id), String(to))
          }
        }
      }
      const names = new Map<string, string>()
      const ids = [...new Set(companyOf.values())]
      for (let i = 0; i < ids.length; i += 100) {
        const out = await call('/crm/v3/objects/companies/batch/read', { properties: ['name'], inputs: ids.slice(i, i + 100).map((id) => ({ id })) })
        for (const r of (out.results ?? []) as Record<string, any>[]) if (r.id !== undefined && r.properties?.name) names.set(String(r.id), String(r.properties.name))
      }
      return tickets.map((t) => {
        const p = (t.properties ?? {}) as Record<string, any>
        const companyId = companyOf.get(String(t.id)) ?? null
        return {
          id: String(t.id),
          subject: plainTicketText(String(p.subject ?? '')),
          content: plainTicketText(String(p.content ?? '')),
          category: p.hs_ticket_category ? prettyCategory(String(p.hs_ticket_category)) : null,
          createdAt: String(p.createdate ?? p.hs_lastmodifieddate ?? new Date().toISOString()),
          modified: String(p.hs_lastmodifieddate ?? p.createdate ?? new Date().toISOString()),
          companyId,
          companyName: companyId ? (names.get(companyId) ?? null) : null,
          url: ticketUrl(String(t.id)),
        }
      })
    },
  }
}
