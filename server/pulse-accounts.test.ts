// Pulse slice 5: read-only Salesforce. Accounts and ARR are copied, matched by name to the accounts on signals, and shown on topics. Nothing is ever written to Salesforce.
// Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { arrFor, normalizeAccount } from './pulse-accounts.js'
import { cleanInstanceUrl, makeSalesforce, SalesforceError } from './salesforce.js'
import { runPulseUpdates } from './pulse.js'
import { fillDemoSignals } from '../scripts/demo-pulse-signals.js'
// @ts-expect-error plain ESM helper
import { setIntegration, buildRow } from '../db/set-integration.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const KEY = randomBytes(32).toString('base64')
const SITE = 'https://acme.my.salesforce.com'
const ACCOUNTS = [
  { Id: '001A', Name: 'Contoso Health, Inc.', ARR__c: 240000 },
  { Id: '001B', Name: 'Fabrikam Retail', ARR__c: 90000 },
  { Id: '001C', Name: 'Northwind Logistics LLC', ARR__c: 150000 },
  { Id: '001D', Name: 'Tailspin Travel', ARR__c: 60000 },
  { Id: '001E', Name: 'Tailspin Travel Inc', ARR__c: 10000 }, // a duplicate: counted once, at the larger value
]

type Calls = { url: string; method: string; body: string }[]
function fakeSalesforce(opts: { pages?: boolean; fail?: string | null } = {}) {
  const calls: Calls = []
  const state = { fail: opts.fail ?? null as string | null }
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? 'GET', body: String(init?.body ?? '') })
    if (url.endsWith('/services/oauth2/token')) {
      if (state.fail === 'invalid_client') return new Response(JSON.stringify({ error: 'invalid_client' }), { status: 400 })
      return new Response(JSON.stringify({ access_token: 'tok', instance_url: 'https://evil.example.test' }))
    }
    if (state.fail === 'INVALID_FIELD') return new Response(JSON.stringify([{ errorCode: 'INVALID_FIELD', message: 'no such column' }]), { status: 400 })
    if (opts.pages && !url.includes('page2')) return new Response(JSON.stringify({ done: false, nextRecordsUrl: '/services/data/v62.0/query/01g-page2', records: ACCOUNTS.slice(0, 2) }))
    return new Response(JSON.stringify({ done: true, records: opts.pages ? ACCOUNTS.slice(2) : ACCOUNTS }))
  }
  return { fetchImpl, calls, state }
}

test('account names are compared without punctuation or legal endings', () => {
  assert.equal(normalizeAccount('Contoso Health, Inc.'), 'contoso health')
  assert.equal(normalizeAccount('  contoso   HEALTH '), 'contoso health')
  assert.equal(normalizeAccount('Johnson & Johnson Co.'), 'johnson and johnson')
  assert.equal(normalizeAccount('Inc'), 'inc', 'a name that is only an ending is kept')
  const known = new Map([['contoso health', { name: 'Contoso Health, Inc.', arr: 100 }], ['fabrikam retail', { name: 'Fabrikam Retail', arr: 50.5 }]])
  assert.deepEqual(arrFor(['Contoso Health', 'contoso health inc', 'Fabrikam Retail', 'Nobody Ltd', 'Unknown', null, ''], known), { arr: 150.5, matched: 2, unmatched: 1 }, 'each account once, unknown skipped')
})

test('the Salesforce address and field are checked, and only reads are made', async () => {
  assert.equal(cleanInstanceUrl('https://acme.my.salesforce.com/'), SITE)
  assert.equal(cleanInstanceUrl('http://acme.my.salesforce.com'), null)
  assert.equal(cleanInstanceUrl('https://salesforce.com.evil.test'), null)
  assert.equal(cleanInstanceUrl('https://user:pw@acme.my.salesforce.com'), null)
  assert.throws(() => buildRow({ SETTINGS_ENCRYPTION_KEY: KEY }, { kind: 'salesforce', secret: 's', site: 'https://evil.test', clientId: 'abcdefghij', arrField: 'ARR__c' }), /salesforce\.com/)
  assert.throws(() => buildRow({ SETTINGS_ENCRYPTION_KEY: KEY }, { kind: 'salesforce', secret: 's', site: SITE, clientId: 'abcdefghij', arrField: 'ARR__c; DELETE' }), /ARR field/)

  const f = fakeSalesforce({ pages: true })
  const sf = makeSalesforce({ instanceUrl: SITE, clientId: 'abcdefghij', clientSecret: 'shh', arrField: 'ARR__c' }, f.fetchImpl)
  const accounts = await sf.fetchAccounts()
  assert.equal(accounts.length, 5, 'both pages were read')
  assert.deepEqual(accounts[0], { id: '001A', name: 'Contoso Health, Inc.', arr: 240000 })
  assert.match(decodeURIComponent(f.calls[1].url.replace(/\+/g, ' ')), /SELECT Id, Name, ARR__c FROM Account WHERE ARR__c != null/)
  assert.ok(f.calls.every((c) => c.url.startsWith(SITE)), 'every call stays on the configured host, not the one Salesforce named')
  assert.ok(f.calls.slice(1).every((c) => c.method === 'GET'), 'nothing but reads after sign-in')
  assert.match(f.calls[0].body, /grant_type=client_credentials/)

  f.state.fail = 'invalid_client'
  await assert.rejects(sf.fetchAccounts(), (e: any) => e instanceof SalesforceError && /client id or secret/.test(e.message))
  f.state.fail = 'INVALID_FIELD'
  // sign-in works again for this one (only the token call checks invalid_client)
  await assert.rejects(sf.fetchAccounts(), (e: any) => e instanceof SalesforceError && /ARR field/.test(e.message))
})

async function fixture(connected = true) {
  const { pglite: pg, db } = await createDemoDatabase()
  const env = { DEV_TOKEN: 's3cret', SETTINGS_ENCRYPTION_KEY: KEY }
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  if (connected) await setIntegration(pg, env, { slug, kind: 'salesforce', secret: 'shh', site: SITE, clientId: 'abcdefghij', arrField: 'ARR__c' })
  const sf = fakeSalesforce()
  const as = (who?: string) => createApp({ env: { ...env, ...(who ? { DEV_USER_EMAIL: `${who}@demo.signalflow.example` } : {}) }, getDb: () => db, salesforceFetch: sf.fetchImpl as any })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as()
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  await call(owner, 'POST', '/pulse/topics/update', { mode: 'regroup' })
  return { pg, db, sf, call, owner, alex: as('alex'), sam: as('sam'), env, slug }
}

test('without Salesforce, topics carry no ARR and the status says it is not connected', async () => {
  const { call, owner } = await fixture(false)
  assert.deepEqual(await (await call(owner, 'GET', '/pulse/salesforce')).json(), { connected: false, accounts: 0, syncedAt: null, error: null })
  const topics = (await (await call(owner, 'GET', '/pulse/topics')).json()).topics
  assert.ok(topics.length > 0 && topics.every((t: any) => t.arr === null))
  const res = await (await call(owner, 'POST', '/pulse/salesforce/sync')).json()
  assert.equal(res.error, 'Salesforce is not connected.')
})

test('sync copies accounts, matches them to signals, and topics show the ARR behind them', async () => {
  const { call, owner, alex, sam, sf, pg } = await fixture()
  for (const [who, status] of [[alex, 403], [sam, 404]] as const) {
    assert.equal((await call(who, 'GET', '/pulse/salesforce')).status, status, 'settings are the owner\'s: an editor is refused, a viewer sees nothing')
    assert.equal((await call(who, 'POST', '/pulse/salesforce/sync')).status, status)
  }
  assert.equal((await owner.request('/api/v1/pulse/salesforce')).status, 404)

  const status = await (await call(owner, 'POST', '/pulse/salesforce/sync')).json()
  assert.equal(status.connected, true)
  assert.equal(status.error, null)
  assert.equal(status.accounts, 4, 'the duplicate Tailspin counted once')
  assert.ok(status.syncedAt)
  assert.ok(sf.calls.slice(1).every((c) => c.method === 'GET'))
  assert.equal(Number((await pg.query<any>(`select arr from core.pulse_accounts where name_key = 'tailspin travel'`)).rows[0].arr), 60000, 'the larger duplicate, not the sum')

  const topics = (await (await call(owner, 'GET', '/pulse/topics')).json()).topics
  const withMoney = topics.filter((t: any) => t.arr > 0)
  assert.ok(withMoney.length > 0)
  for (const t of topics) {
    const detail = await (await call(owner, 'GET', `/pulse/topics/${t.id}`)).json()
    const expected = detail.accounts.reduce((n: number, a: any) => n + (a.arr ?? 0), 0)
    assert.equal(t.arr, expected, `${t.title}: the topic's ARR is its matched accounts added up`)
    assert.equal(t.arrMatched, detail.accounts.filter((a: any) => a.arr !== null).length)
    assert.equal(t.arrMatched + t.arrUnmatched, detail.accounts.length, 'every named account is either found or counted as not found')
  }
  const names = (await (await call(owner, 'GET', `/pulse/topics/${topics[0].id}`)).json()).accounts
  assert.ok(names.some((a: any) => a.arr === null) || topics.some((t: any) => t.arrUnmatched > 0), 'accounts missing from Salesforce are shown as not found')
})

test('a Salesforce problem keeps the last copy and says why; the hourly job syncs once a day', async () => {
  const { call, owner, sf, db, pg } = await fixture()
  await call(owner, 'POST', '/pulse/salesforce/sync')
  sf.state.fail = 'INVALID_FIELD'
  const failed = await (await call(owner, 'POST', '/pulse/salesforce/sync')).json()
  assert.match(failed.error, /ARR field/)
  assert.equal(failed.accounts, 4, 'the earlier copy stays')
  assert.ok(failed.syncedAt, 'and its time')
  sf.state.fail = null
  assert.equal((await (await call(owner, 'POST', '/pulse/salesforce/sync')).json()).error, null, 'recovers')

  // The job: not due right after a try, due after a day.
  const tokenCalls = () => sf.calls.filter((c) => c.url.endsWith('/oauth2/token')).length
  const before = tokenCalls()
  const dbSf = { check: async () => {}, fetchAccounts: async () => [{ id: '1', name: 'Contoso Health', arr: 1 }], fetchOpportunities: async () => [], refreshOpportunities: async () => [] }
  await runPulseUpdates(db, undefined, async () => dbSf)
  assert.equal(Number((await pg.query<any>(`select arr from core.pulse_accounts where name_key = 'contoso health'`)).rows[0].arr), 240000, 'not due yet: untouched')
  await pg.query(`update core.pulse_account_sync set tried_at = now() - interval '25 hours'`)
  await runPulseUpdates(db, undefined, async () => dbSf)
  assert.equal(Number((await pg.query<any>(`select arr from core.pulse_accounts where name_key = 'contoso health'`)).rows[0].arr), 1, 'due: copied')
  assert.equal(tokenCalls(), before, 'the stand-in client did the job, not the network')
})
