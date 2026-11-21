// The Salesforce connection, read only: Pulse copies each Account's id, name and ARR so topics can show the revenue behind the accounts that raised them. Nothing is ever
// written to Salesforce, and no other object or field is read. It signs in as an "External Client App" with the OAuth client credentials flow, which acts as one run-as
// user; that user's permissions (read on Account and the ARR field) are the real limit on what can be seen. Nothing here touches the database. `fetch` is passed in so tests can
// stand in for Salesforce.
export type SalesforceFetch = (url: string, init?: RequestInit) => Promise<Response>
export type SalesforceConfig = { instanceUrl: string; clientId: string; clientSecret: string; arrField: string }
export type SfAccount = { id: string; name: string; arr: number }

export class SalesforceError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? salesforceProblem(code))
  }
}

export function salesforceProblem(code: string): string {
  switch (code) {
    case 'invalid_client':
    case 'invalid_client_id':
    case 'unauthorized_client':
      return 'Salesforce refused the app’s client id or secret. Check them, and that the client credentials flow is switched on with a run-as user.'
    case 'invalid_grant':
    case 'inactive_user':
      return 'Salesforce would not sign the app in. Check that the run-as user is active.'
    case 'INVALID_FIELD':
      return 'Salesforce has no such ARR field on Account, or the run-as user cannot read it. Check the field’s API name (it ends in __c for a custom field) and its field-level security.'
    case 'INSUFFICIENT_ACCESS':
    case 'INVALID_TYPE':
      return 'The run-as user cannot read Accounts. Give it read access to the Account object.'
    case 'REQUEST_LIMIT_EXCEEDED':
      return 'Salesforce says the daily API limit is used up. It will be tried again.'
    case 'not_connected':
      return 'Salesforce is not connected yet.'
    case 'bad_instance':
      return 'The Salesforce address must be https and end in .salesforce.com or .force.com.'
    default:
      return `Salesforce said: ${code}`
  }
}

/** The address as stored: https, a Salesforce host, no trailing slash. Null when it is anything else (so a stored value can never point the server at another site). */
export function cleanInstanceUrl(input: string): string | null {
  try {
    const u = new URL(input.trim())
    if (u.protocol !== 'https:' || !/(^|\.)(salesforce|force)\.com$/i.test(u.hostname) || u.username || u.password) return null
    return `https://${u.host}`
  } catch {
    return null
  }
}

/** A field's API name: letters, digits, underscores (the check that keeps it safe to place in a query). */
export const isFieldName = (s: string) => /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(s)

export type OpportunityScope = 'open' | 'lost' | 'both'
export type SfOpportunity = {
  id: string
  name: string
  accountId: string | null
  accountName: string | null
  amount: number | null
  stage: string | null
  closeDate: string | null
  state: 'open' | 'lost' | 'won'
  modified: string
  /** The designated fields' text, by field name; a field with no text is left out. */
  notes: Record<string, string>
}
export type OpportunityQuery = { fields: string[]; scope: OpportunityScope; amountField: string; since: string }
export type SalesforceClient = {
  fetchAccounts(): Promise<SfAccount[]>
  fetchOpportunities(q: OpportunityQuery): Promise<SfOpportunity[]>
  /** The current amount, stage and state of opportunities already read (their ids), so a deal that closed since stops counting as in play. */
  refreshOpportunities(ids: string[], amountField: string): Promise<SfOpportunity[]>
}

const MAX_ACCOUNTS = 20_000
const MAX_OPPORTUNITIES = 2_000
export const MAX_NOTE_FIELDS = 5
const LOST_DAYS = 90
const API = 'v62.0'

function toOpportunity(r: Record<string, any>, amountField: string, fields: string[]): SfOpportunity[] {
  if (!r.Id || !r.LastModifiedDate) return []
  const raw = r[amountField]
  const amount = raw === null || raw === undefined ? NaN : Number(raw)
  const notes: Record<string, string> = {}
  for (const f of fields) if (typeof r[f] === 'string' && r[f].trim()) notes[f] = r[f]
  const state = r.IsClosed === false ? 'open' : r.IsWon === true ? 'won' : 'lost'
  return [{ id: String(r.Id), name: String(r.Name ?? ''), accountId: r.AccountId ? String(r.AccountId) : null, accountName: r.Account?.Name ? String(r.Account.Name) : null, amount: Number.isFinite(amount) ? amount : null, stage: r.StageName ? String(r.StageName) : null, closeDate: r.CloseDate ? String(r.CloseDate) : null, state, modified: String(r.LastModifiedDate), notes }]
}

export function makeSalesforce(cfg: SalesforceConfig, fetchImpl: SalesforceFetch = fetch): SalesforceClient {
  const base = cleanInstanceUrl(cfg.instanceUrl)
  const fail = (body: any, status: number): never => {
    const first = Array.isArray(body) ? body[0] : body
    throw new SalesforceError(String(first?.errorCode ?? first?.error ?? `http_${status}`))
  }
  // Signs in and runs one SOQL query, following the pages of the answer (only paths on the configured host). Only ever GETs after the sign-in.
  async function query(soql: string, limit: number): Promise<Record<string, any>[]> {
    if (!base) throw new SalesforceError('bad_instance')
    const tokenRes = await fetchImpl(`${base}/services/oauth2/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }),
      signal: AbortSignal.timeout(10_000),
    })
    const token = (await tokenRes.json().catch(() => ({}))) as Record<string, any>
    if (!tokenRes.ok || !token.access_token) fail(token, tokenRes.status)
    const headers = { authorization: `Bearer ${token.access_token}` }
    let next: string | null = `/services/data/${API}/query?${new URLSearchParams({ q: soql })}`
    const records: Record<string, any>[] = []
    for (let page = 0; next && page < 40 && records.length < limit; page++) {
      if (!next.startsWith('/services/data/')) break
      const res = await fetchImpl(`${base}${next}`, { headers, signal: AbortSignal.timeout(15_000) })
      const body = (await res.json().catch(() => ({}))) as Record<string, any>
      if (!res.ok) fail(body, res.status)
      records.push(...((body.records ?? []) as Record<string, any>[]))
      next = body.done === false && typeof body.nextRecordsUrl === 'string' ? body.nextRecordsUrl : null
    }
    return records
  }
  return {
    async fetchAccounts() {
      if (!isFieldName(cfg.arrField)) throw new SalesforceError('bad_instance')
      const rows = await query(`SELECT Id, Name, ${cfg.arrField} FROM Account WHERE ${cfg.arrField} != null`, MAX_ACCOUNTS)
      const accounts: SfAccount[] = []
      for (const r of rows) {
        const arr = Number(r[cfg.arrField])
        if (r.Id && r.Name && Number.isFinite(arr) && arr >= 0) accounts.push({ id: String(r.Id), name: String(r.Name), arr })
      }
      return accounts.slice(0, MAX_ACCOUNTS)
    },
    async fetchOpportunities(q) {
      const fields = [...new Set(q.fields)]
      if (!fields.length || fields.length > MAX_NOTE_FIELDS || !fields.every(isFieldName) || !isFieldName(q.amountField) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(q.since)) throw new SalesforceError('INVALID_FIELD')
      const scope = q.scope === 'open' ? 'IsClosed = false' : q.scope === 'lost' ? `(IsClosed = true AND IsWon = false AND CloseDate >= LAST_N_DAYS:${LOST_DAYS})` : `(IsClosed = false OR (IsWon = false AND CloseDate >= LAST_N_DAYS:${LOST_DAYS}))`
      const select = [...new Set(['Id', 'Name', 'AccountId', 'Account.Name', q.amountField, 'StageName', 'CloseDate', 'IsClosed', 'IsWon', 'LastModifiedDate', ...fields])].join(', ')
      const rows = await query(`SELECT ${select} FROM Opportunity WHERE LastModifiedDate > ${q.since} AND ${scope} ORDER BY LastModifiedDate ASC`, MAX_OPPORTUNITIES)
      return rows.slice(0, MAX_OPPORTUNITIES).flatMap((r) => toOpportunity(r, q.amountField, fields))
    },
    async refreshOpportunities(ids, amountField) {
      const clean = [...new Set(ids)].filter((id) => /^[A-Za-z0-9]{15,18}$/.test(id)).slice(0, 200)
      if (!clean.length || !isFieldName(amountField)) return []
      const select = [...new Set(['Id', 'Name', 'AccountId', 'Account.Name', amountField, 'StageName', 'CloseDate', 'IsClosed', 'IsWon', 'LastModifiedDate'])].join(', ')
      const rows = await query(`SELECT ${select} FROM Opportunity WHERE Id IN (${clean.map((id) => `'${id}'`).join(', ')})`, 200)
      return rows.flatMap((r) => toOpportunity(r, amountField, []))
    },
  }
}
