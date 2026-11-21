// Pulse slice 7: Salesforce opportunity notes as signals, and what is at stake behind a topic (open and lost opportunity amounts, each opportunity once).
// Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { makeSalesforce } from './salesforce.js'
import { playStats } from './pulse-topics.js'
// @ts-expect-error plain ESM helper
import { setIntegration } from '../db/set-integration.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const KEY = randomBytes(32).toString('base64')
const SITE = 'https://acme.my.salesforce.com'
const NOW = Date.now()
const stamp = (hoursAgo: number) => new Date(NOW - hoursAgo * 3_600_000).toISOString().replace('Z', '+0000')
const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString().slice(0, 10)

type Opp = Record<string, any>
const opp = (n: number, over: Opp = {}): Opp => ({ Id: `006${String(n).padStart(12, '0')}AAA`, Name: `Deal ${n}`, AccountId: '001A', Account: { Name: 'Contoso Health, Inc.' }, Amount: 100000, StageName: 'Negotiation', CloseDate: day(30), IsClosed: false, IsWon: false, LastModifiedDate: stamp(10 - n), NextStep: '', Description: '', ...over })

function fakeSalesforce(state: { opps: Opp[] }) {
  const queries: string[] = []
  const fetchImpl = async (url: string, init?: RequestInit) => {
    if (url.endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 't' }))
    assert.equal(init?.method ?? 'GET', 'GET', 'only reads after sign-in')
    const soql = decodeURIComponent(url.replace(/\+/g, ' '))
    queries.push(soql)
    if (/FROM Account/.test(soql)) return new Response(JSON.stringify({ done: true, records: [{ Id: '001A', Name: 'Contoso Health, Inc.', ARR__c: 240000 }, { Id: '001B', Name: 'Fabrikam Retail', ARR__c: 90000 }] }))
    if (/Id IN \(/.test(soql)) {
      const ids = [...soql.matchAll(/'([A-Za-z0-9]+)'/g)].map((m) => m[1])
      return new Response(JSON.stringify({ done: true, records: state.opps.filter((o) => ids.includes(o.Id)) }))
    }
    const since = /LastModifiedDate > (\S+)/.exec(soql)![1]
    return new Response(JSON.stringify({ done: true, records: state.opps.filter((o) => new Date(o.LastModifiedDate.replace(/(\d{2})(\d{2})$/, '$1:$2')) > new Date(since)) }))
  }
  return { fetchImpl, queries }
}

test('opportunity queries name only the designated fields, and an unsafe field name is refused', async () => {
  const state = { opps: [opp(1, { NextStep: 'Waiting on the score explanation.' }), opp(2, { IsClosed: true, IsWon: true }), opp(3, { IsClosed: true, IsWon: false })] }
  const f = fakeSalesforce(state)
  const sf = makeSalesforce({ instanceUrl: SITE, clientId: 'abcdefghij', clientSecret: 's', arrField: 'ARR__c' }, f.fetchImpl)
  const got = await sf.fetchOpportunities({ fields: ['NextStep'], scope: 'both', amountField: 'Amount', since: '2020-01-01T00:00:00Z' })
  assert.deepEqual(got.map((o) => o.state), ['open', 'won', 'lost'])
  assert.deepEqual(got[0].notes, { NextStep: 'Waiting on the score explanation.' })
  assert.match(f.queries[0], /SELECT Id, Name, AccountId, Account\.Name, Amount, StageName, CloseDate, IsClosed, IsWon, LastModifiedDate, NextStep FROM Opportunity WHERE LastModifiedDate > 2020-01-01T00:00:00Z AND \(IsClosed = false OR \(IsWon = false AND CloseDate >= LAST_N_DAYS:90\)\)/)
  await sf.fetchOpportunities({ fields: ['NextStep'], scope: 'open', amountField: 'Amount', since: '2020-01-01T00:00:00Z' })
  assert.match(f.queries[1], /AND IsClosed = false ORDER BY/)
  for (const bad of [['NextStep FROM Account--'], ['A'.repeat(70)], []]) await assert.rejects(sf.fetchOpportunities({ fields: bad, scope: 'both', amountField: 'Amount', since: '2020-01-01T00:00:00Z' }))
  await assert.rejects(sf.fetchOpportunities({ fields: ['NextStep'], scope: 'both', amountField: 'Amount', since: "2020' OR Name != '" }))
})

test('what is at stake adds each opportunity once: open in play, lost separately, won in neither', () => {
  const rows = [
    { oppId: 'a', amount: 100, state: 'open' as const, closeDate: '2026-12-01' },
    { oppId: 'a', amount: 100, state: 'open' as const, closeDate: '2026-12-01' },
    { oppId: 'b', amount: 50.5, state: 'open' as const, closeDate: '2027-06-01' },
    { oppId: 'c', amount: 70, state: 'lost' as const, closeDate: '2026-11-01' },
    { oppId: 'd', amount: 999, state: 'won' as const, closeDate: '2026-10-01' },
    { oppId: null, amount: 5, state: null, closeDate: null },
  ]
  assert.deepEqual(playStats(rows, new Date('2026-11-21T00:00:00Z')), { open: { count: 2, amount: 150.5, closingSoon: 1 }, lost: { count: 1, amount: 70 } })
  assert.equal(playStats([{ oppId: null, amount: null, state: null, closeDate: null }]), null)
})

async function fixture(connected = true) {
  const { pglite: pg, db } = await createDemoDatabase()
  const env = { DEV_TOKEN: 's3cret', SETTINGS_ENCRYPTION_KEY: KEY }
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  if (connected) await setIntegration(pg, env, { slug, kind: 'salesforce', secret: 'shh', site: SITE, clientId: 'abcdefghij', arrField: 'ARR__c' })
  const state = { opps: [] as Opp[] }
  const f = fakeSalesforce(state)
  const as = (who?: string) => createApp({ env: { ...env, ...(who ? { DEV_USER_EMAIL: `${who}@demo.signalflow.example` } : {}) }, getDb: () => db, salesforceFetch: f.fetchImpl as any })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as()
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  return { pg, db, call, owner, alex: as('alex'), state, f }
}

test('the opportunity source: owners only, validated, one per workspace, audited, and honest when Salesforce is not connected', async () => {
  const { call, owner, alex, pg } = await fixture(false)
  assert.equal((await call(alex, 'POST', '/pulse/sources/opportunities', { fields: ['NextStep'] })).status, 403)
  assert.equal((await call(owner, 'POST', '/pulse/sources/opportunities', { fields: [] })).status, 422)
  assert.equal((await call(owner, 'POST', '/pulse/sources/opportunities', { fields: ['Next Step'] })).status, 422, 'API names only')
  assert.equal((await call(owner, 'POST', '/pulse/sources/opportunities', { fields: ['A', 'B', 'C', 'D', 'E', 'F'] })).status, 422, 'up to five')
  const made = await call(owner, 'POST', '/pulse/sources/opportunities', { fields: ['NextStep', 'Description'] })
  assert.equal(made.status, 201)
  const src = await made.json()
  assert.deepEqual([src.kind, src.channel, src.mode, src.config], ['salesforce_opportunity', 'salesforce', 'review', { fields: ['NextStep', 'Description'], scope: 'both', amountField: 'Amount' }])
  assert.equal((await call(owner, 'POST', '/pulse/sources/opportunities', { fields: ['NextStep'] })).status, 422, 'one per workspace')
  const res = await (await call(owner, 'POST', `/pulse/sources/${src.id}/check`)).json()
  assert.deepEqual(res, { added: 0, error: 'Salesforce is not connected yet.' })
  assert.deepEqual((await pg.query<any>(`select verb from core.audit_log where entity = 'core.pulse_sources'`)).rows.map((r: any) => r.verb), ['added'])
})

test('reading opportunity notes: signals with the deal behind them, once; topics show what is at stake, with ARR found by account id', async () => {
  const { call, owner, state, f, pg } = await fixture()
  await call(owner, 'POST', '/pulse/salesforce/sync')
  state.opps = [
    // Two fields on one deal: two signals, one opportunity. The account's name differs from Salesforce's account record; its id still finds the ARR.
    opp(1, { Account: { Name: 'Contoso (the clinic group)' }, NextStep: 'They do not trust the health score and want an explanation of it.', Description: 'The exec team cannot trust the score after it was wrong on a renewal.' }),
    opp(2, { AccountId: '001B', Account: { Name: 'Fabrikam Retail' }, Amount: 50000, NextStep: 'Nobody trusts the score here either, they ask for the factors behind it.' }),
    opp(3, { AccountId: '001B', Account: { Name: 'Fabrikam Retail' }, Amount: 30000, IsClosed: true, IsWon: false, StageName: 'Closed Lost', Description: 'Lost because the team could not trust the score and went back to spreadsheets.' }),
    opp(4, { NextStep: 'ok' }), // too short to be a signal
    opp(5, { IsClosed: true, IsWon: true, NextStep: 'Won; they love the timeline and trust it completely.' }), // won: never counts as at stake
  ]
  const src = await (await call(owner, 'POST', '/pulse/sources/opportunities', { fields: ['NextStep', 'Description'], mode: 'keep' })).json()
  const res = await (await call(owner, 'POST', `/pulse/sources/${src.id}/check`)).json()
  assert.deepEqual(res, { added: 5, error: null }, 'five notes from four deals with words')
  const sigs = (await pg.query<any>(`select source, channel, status, account, account_sf_id, opp_id, opp_state, opp_amount::float8 as amount, external_id from core.pulse_signals where source = 'salesforce' order by external_id`)).rows
  assert.ok(sigs.every((s: any) => s.channel === 'salesforce' && s.status === 'kept'))
  assert.equal(sigs.filter((s: any) => s.opp_id === state.opps[0].Id).length, 2)
  assert.deepEqual((await (await call(owner, 'POST', `/pulse/sources/${src.id}/check`)).json()), { added: 0, error: null }, 'never read twice')
  assert.match(f.queries.filter((q) => /FROM Opportunity WHERE LastModifiedDate/.test(q)).at(-1)!, /LastModifiedDate > \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z/, 'the next read starts after the newest change')

  const list = await (await call(owner, 'POST', '/pulse/topics/update', { mode: 'regroup' })).json()
  const topic = list.topics.find((t: any) => t.inPlay)
  assert.ok(topic, 'a topic with opportunities behind it')
  assert.deepEqual(topic.inPlay.open, { count: 2, amount: 150000, closingSoon: 2 }, 'two open deals, one counted once though it had two notes')
  assert.deepEqual(topic.inPlay.lost, { count: 1, amount: 30000 })
  assert.equal(topic.arr, 330000, 'Contoso found by its Salesforce id, Fabrikam by name: 240000 + 90000')
  assert.ok(topic.breakdown.some((b: any) => b.channel === 'salesforce' && b.weight === 0.8))
  const detail = await (await call(owner, 'GET', `/pulse/topics/${topic.id}`)).json()
  assert.ok(detail.quotes.some((q: any) => q.opportunity?.name === 'Deal 1' && q.opportunity.state === 'open' && q.opportunity.amount === 100000))

  // A deal that closes with a win stops counting as in play at the next read, though its notes stay.
  state.opps[1] = { ...state.opps[1], IsClosed: true, IsWon: true, StageName: 'Closed Won', LastModifiedDate: stamp(0.1) }
  await call(owner, 'POST', `/pulse/sources/${src.id}/check`)
  const after = (await (await call(owner, 'GET', '/pulse/topics')).json()).topics.find((t: any) => t.id === topic.id)
  assert.deepEqual(after.inPlay.open, { count: 1, amount: 100000, closingSoon: 1 })
})
