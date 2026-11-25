// A stand-in for HubSpot's API, for tests and the local demo (HUBSPOT_DEMO=true): it answers the three calls the connection makes (ticket search, ticket-to-company associations and a
// company name read) from a list of tickets. It checks the bearer key, pages the search like HubSpot (`after`), and honours the modified-since and category filters.
import type { HubspotFetch } from './hubspot.js'

export type DemoTicket = { id: string; subject: string; content: string; category: string | null; created: string; modified: string; company: { id: string; name: string } | null }

const iso = (daysAgo: number, hour = 10) => new Date(Date.now() - daysAgo * 86_400_000 + (hour - 12) * 3_600_000).toISOString()

/** Anchor CX support tickets (categories under HubSpot's internal names, as its API returns them): the same story as the sample signals (the health score, handoffs, manual reporting, renewal prep), written the way customers write to support. */
export const DEMO_TICKETS: DemoTicket[] = [
  { id: '9001', subject: 'Health score dropped 18 points overnight', content: 'Our health score for three accounts fell sharply and nobody on my team can tell why. Can you show which factors moved it?', category: 'PRODUCT_ISSUE', created: iso(3), modified: iso(3), company: { id: '501', name: 'Northwind Logistics' } },
  { id: '9002', subject: 'Why is the score amber?', content: 'A customer asked why their health went amber and I could not explain it on the call. There is no list of what changed.', category: 'GENERAL_INQUIRY', created: iso(6), modified: iso(5), company: { id: '502', name: 'Tailspin Travel' } },
  { id: '9003', subject: 'Score showed green before a churn', content: 'The score said green on an account that churned three weeks later. We do not trust it for renewals anymore.', category: 'PRODUCT_ISSUE', created: iso(9), modified: iso(9), company: { id: '503', name: 'Contoso Health' } },
  { id: '9004', subject: 'Handoff from support loses the history', content: 'When a case moves from support to success I get a link and nothing else. I redo the whole investigation from scratch.', category: 'PRODUCT_ISSUE', created: iso(11), modified: iso(10), company: { id: '504', name: 'Wide World Importers' } },
  { id: '9005', subject: 'Need context attached when handing an account over', content: 'We need a way to hand an account to success with the history attached, not a message that says please take this one.', category: 'FEATURE_REQUEST', created: iso(14), modified: iso(14), company: { id: '501', name: 'Northwind Logistics' } },
  { id: '9006', subject: 'Monthly portfolio report is manual', content: 'I spend the first Monday of every month building the portfolio report by hand from three exports. Can this be scheduled or sent as a digest?', category: 'FEATURE_REQUEST', created: iso(17), modified: iso(16), company: { id: '505', name: 'Fabrikam Retail' } },
  { id: '9007', subject: 'Weekly digest of changed accounts', content: 'A weekly digest of the accounts that changed would save me the Monday scramble. I would read it every time.', category: 'FEATURE_REQUEST', created: iso(21), modified: iso(21), company: { id: '503', name: 'Contoso Health' } },
  { id: '9008', subject: 'Renewal prep needs five tabs', content: 'Preparing a renewal means opening five tabs. All the context is there, just not on one page.', category: 'PRODUCT_ISSUE', created: iso(26), modified: iso(25), company: { id: '505', name: 'Fabrikam Retail' } },
  { id: '9009', subject: 'Invoice copy', content: 'Please resend the invoice for October.', category: 'BILLING_ISSUE', created: iso(30), modified: iso(30), company: { id: '506', name: 'Adventure Works' } },
  { id: '9010', subject: 'Executives stopped using the score', content: 'Our execs stopped looking at the score in the weekly review. They ask for the spreadsheet instead.', category: 'PRODUCT_ISSUE', created: iso(35), modified: iso(34), company: { id: '506', name: 'Adventure Works' } },
]

export function demoHubspotFetch(tickets: DemoTicket[] = DEMO_TICKETS, key = 'demo-key', pageSize = 100): HubspotFetch {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  return async (url, init) => {
    const path = new URL(url).pathname
    if ((init?.headers as Record<string, string> | undefined)?.authorization !== `Bearer ${key}`) return json({ status: 'error', message: 'invalid' }, 401)
    const body = JSON.parse(String(init?.body ?? '{}'))
    if (path === '/crm/v3/objects/tickets/search') {
      const filters = (body.filterGroups?.[0]?.filters ?? []) as { propertyName: string; operator: string; value?: string; values?: string[] }[]
      let rows = tickets
      for (const f of filters) {
        if (f.propertyName === 'hs_lastmodifieddate') rows = rows.filter((t) => Date.parse(t.modified) >= Number(f.value))
        if (f.propertyName === 'hs_ticket_category') rows = rows.filter((t) => t.category !== null && (f.values ?? []).includes(t.category))
      }
      rows = [...rows].sort((a, b) => Date.parse(a.modified) - Date.parse(b.modified))
      const start = Number(body.after ?? 0)
      const limit = Math.min(Number(body.limit ?? pageSize), pageSize)
      const page = rows.slice(start, start + limit)
      return json({
        results: page.map((t) => ({ id: t.id, properties: { subject: t.subject, content: t.content, hs_ticket_category: t.category, createdate: t.created, hs_lastmodifieddate: t.modified } })),
        ...(start + limit < rows.length ? { paging: { next: { after: String(start + limit) } } } : {}),
      })
    }
    if (path === '/crm/v4/associations/tickets/companies/batch/read') {
      const ids = (body.inputs as { id: string }[]).map((i) => i.id)
      return json({ results: tickets.filter((t) => ids.includes(t.id) && t.company).map((t) => ({ from: { id: t.id }, to: [{ toObjectId: Number(t.company!.id) }] })) })
    }
    if (path === '/crm/v3/objects/companies/batch/read') {
      const ids = (body.inputs as { id: string }[]).map((i) => i.id)
      const seen = new Map<string, string>()
      for (const t of tickets) if (t.company && ids.includes(t.company.id)) seen.set(t.company.id, t.company.name)
      return json({ results: [...seen].map(([id, name]) => ({ id, properties: { name } })) })
    }
    return json({ status: 'error', message: 'not found' }, 404)
  }
}
