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

export type SalesforceClient = { fetchAccounts(): Promise<SfAccount[]> }

const MAX_ACCOUNTS = 20_000
const API = 'v62.0'

export function makeSalesforce(cfg: SalesforceConfig, fetchImpl: SalesforceFetch = fetch): SalesforceClient {
  const base = cleanInstanceUrl(cfg.instanceUrl)
  const fail = (body: any, status: number): never => {
    const first = Array.isArray(body) ? body[0] : body
    throw new SalesforceError(String(first?.errorCode ?? first?.error ?? `http_${status}`))
  }
  return {
    async fetchAccounts() {
      if (!base || !isFieldName(cfg.arrField)) throw new SalesforceError('bad_instance')
      const tokenRes = await fetchImpl(`${base}/services/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: cfg.clientId, client_secret: cfg.clientSecret }),
        signal: AbortSignal.timeout(10_000),
      })
      const token = (await tokenRes.json().catch(() => ({}))) as Record<string, any>
      if (!tokenRes.ok || !token.access_token) fail(token, tokenRes.status)
      const headers = { authorization: `Bearer ${token.access_token}` }
      const soql = `SELECT Id, Name, ${cfg.arrField} FROM Account WHERE ${cfg.arrField} != null`
      let next: string | null = `/services/data/${API}/query?${new URLSearchParams({ q: soql })}`
      const accounts: SfAccount[] = []
      for (let page = 0; next && page < 40 && accounts.length < MAX_ACCOUNTS; page++) {
        // Only a path on the same host is followed, whatever Salesforce hands back.
        if (!next.startsWith('/services/data/')) break
        const res = await fetchImpl(`${base}${next}`, { headers, signal: AbortSignal.timeout(15_000) })
        const body = (await res.json().catch(() => ({}))) as Record<string, any>
        if (!res.ok) fail(body, res.status)
        for (const r of (body.records ?? []) as Record<string, any>[]) {
          const arr = Number(r[cfg.arrField])
          if (r.Id && r.Name && Number.isFinite(arr) && arr >= 0) accounts.push({ id: String(r.Id), name: String(r.Name), arr })
        }
        next = body.done === false && typeof body.nextRecordsUrl === 'string' ? body.nextRecordsUrl : null
      }
      return accounts
    },
  }
}
