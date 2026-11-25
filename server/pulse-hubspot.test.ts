// Pulse: HubSpot support tickets as a channel. Connected with a service key (set by the operator), designated by an owner, read about hourly; each ticket becomes one signal in the
// Support tickets channel with its company and a link back, counts at once, and joins topics. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { DEMO_TICKETS, demoHubspotFetch, type DemoTicket } from './hubspot-demo.js'
import { runPulseUpdates } from './pulse.js'
// @ts-expect-error plain ESM helper
import { setIntegration } from '../db/set-integration.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const KEY = randomBytes(32).toString('base64')
const SERVICE_KEY = 'pat-na1-demo-service-key-abcdef123456'

async function fixture(connected = true, tickets: DemoTicket[] = DEMO_TICKETS) {
  const { pglite: pg, db } = await createDemoDatabase()
  const env = { DEV_TOKEN: 's3cret', SETTINGS_ENCRYPTION_KEY: KEY }
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  if (connected) await setIntegration(pg, env, { slug, kind: 'hubspot', secret: SERVICE_KEY, portalId: '4455667' })
  const stand = { tickets }
  const app = createApp({ env, getDb: () => db, hubspotFetch: async (url, init) => demoHubspotFetch(stand.tickets, SERVICE_KEY)(url, init) })
  const call = (method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  await call('PUT', '/pulse/preview', { enabled: true })
  return { pg, db, call, stand, env, slug }
}

test('the connection is checked with one tiny read, and says plainly when it is missing or refused', async () => {
  const none = await fixture(false)
  assert.deepEqual(await (await none.call('GET', '/pulse/hubspot')).json(), { connected: false, error: null })
  assert.deepEqual(await (await none.call('POST', '/pulse/hubspot/check')).json(), { connected: false, error: null })

  const ok = await fixture()
  assert.deepEqual(await (await ok.call('GET', '/pulse/hubspot')).json(), { connected: true, error: null })
  assert.deepEqual(await (await ok.call('POST', '/pulse/hubspot/check')).json(), { connected: true, error: null })

  // The same workspace with a key HubSpot refuses.
  await setIntegration(ok.pg, ok.env, { slug: ok.slug, kind: 'hubspot', secret: 'pat-na1-a-different-key-that-is-wrong-12345' })
  const app2 = createApp({ env: ok.env, getDb: () => ok.db, hubspotFetch: demoHubspotFetch(DEMO_TICKETS, SERVICE_KEY) })
  const refused = await app2.request('/api/v1/pulse/hubspot/check', { method: 'POST', headers })
  assert.match((await refused.json()).error, /refused the key/)
})

test('an owner designates tickets once; they are read as signals in the Support tickets channel, with company and link, counting at once', async () => {
  const { call, pg } = await fixture()
  assert.deepEqual((await call('POST', '/pulse/sources/tickets', { categories: new Array(11).fill('x') })).status, 422, 'up to ten categories')
  const made = await call('POST', '/pulse/sources/tickets', { categories: [] })
  assert.equal(made.status, 201)
  const src = await made.json()
  assert.deepEqual([src.kind, src.channel, src.mode, src.config], ['hubspot_tickets', 'support_tickets', 'keep', { categories: [] }])
  assert.equal((await call('POST', '/pulse/sources/tickets', {})).status, 422, 'one tickets source per workspace')

  const read = await (await call('POST', `/pulse/sources/${src.id}/check`)).json()
  assert.deepEqual(read, { added: DEMO_TICKETS.length, error: null, duplicates: 0 })
  const rows = (await pg.query<any>(`select body, channel, source, source_label, source_url, account, status, external_id from core.pulse_signals where source = 'hubspot' order by external_id`)).rows
  assert.equal(rows.length, DEMO_TICKETS.length)
  assert.ok(rows.every((r: any) => r.channel === 'support_tickets' && r.status === 'kept'), 'every ticket counts at once, in its own channel')
  const t1 = rows.find((r: any) => r.external_id === '9001')
  assert.deepEqual([t1.account, t1.source_label, t1.source_url], ['Northwind Logistics', 'Ticket · Product issue', 'https://app.hubspot.com/contacts/4455667/record/0-5/9001'])
  assert.match(t1.body, /^Health score dropped 18 points overnight\. Our health score for three accounts/)

  assert.equal((await (await call('POST', `/pulse/sources/${src.id}/check`)).json()).added, 0, 'a ticket is read once')
  const list = await (await call('GET', '/pulse/sources')).json()
  assert.deepEqual([list.sources[0].lastAdded, list.sources[0].lastError], [0, null])
})

test('a ticket that changes is not read again, a new one is, and near-identical tickets from different customers each count', async () => {
  const { call, stand } = await fixture(true, DEMO_TICKETS.slice(0, 3))
  const src = await (await call('POST', '/pulse/sources/tickets', {})).json()
  assert.equal((await (await call('POST', `/pulse/sources/${src.id}/check`)).json()).added, 3)
  const now = new Date().toISOString()
  stand.tickets = [{ ...DEMO_TICKETS[0], modified: now }, ...DEMO_TICKETS.slice(1, 3), { ...DEMO_TICKETS[0], id: '9101', company: { id: '507', name: 'Initech' }, modified: now }, { ...DEMO_TICKETS[0], id: '9102', company: { id: '508', name: 'Umbrella' }, modified: now }]
  const second = await (await call('POST', `/pulse/sources/${src.id}/check`)).json()
  assert.equal(second.added, 2, 'the edited ticket is not read twice; the two new ones, word for word alike but from different customers, both count')
  const topics = await (await call('POST', '/pulse/topics/update', {})).json()
  assert.ok(topics.topics.some((t: any) => (t.channels.support_tickets ?? 0) >= 3), 'tickets join the topics, in their own channel')
})

test('only the named categories are read, and a problem stays on the source without stopping anything', async () => {
  const { call, pg } = await fixture()
  const src = await (await call('POST', '/pulse/sources/tickets', { categories: ['Feature request'] })).json()
  assert.deepEqual(src.config, { categories: ['Feature request'] })
  assert.equal((await (await call('POST', `/pulse/sources/${src.id}/check`)).json()).added, 3)
  assert.deepEqual(((await pg.query<any>(`select distinct source_label from core.pulse_signals where source = 'hubspot'`)).rows).map((r: any) => r.source_label), ['Ticket · Feature request'])

  const unconnected = await fixture(false)
  const s2 = await (await unconnected.call('POST', '/pulse/sources/tickets', {})).json()
  const res = await (await unconnected.call('POST', `/pulse/sources/${s2.id}/check`)).json()
  assert.deepEqual([res.added, res.error], [0, 'HubSpot is not connected yet.'])
  assert.equal((await (await unconnected.call('GET', '/pulse/sources')).json()).sources[0].lastError, 'HubSpot is not connected yet.')
})

test('the hourly job reads tickets too, and only an owner can designate or test', async () => {
  const { call, db, env, pg, slug } = await fixture()
  await call('POST', '/pulse/sources/tickets', {})
  const app = createApp({ env, getDb: () => db, hubspotFetch: demoHubspotFetch(DEMO_TICKETS, SERVICE_KEY) })
  assert.ok(app)
  const { makeHubspot } = await import('./hubspot.js')
  const run = await runPulseUpdates(db, undefined, undefined, async () => makeHubspot({ token: SERVICE_KEY, portalId: null }, demoHubspotFetch(DEMO_TICKETS, SERVICE_KEY)))
  assert.ok(run.read >= DEMO_TICKETS.length, 'the hourly job read the tickets')
  const alex = createApp({ env: { ...env, DEV_USER_EMAIL: 'alex@demo.signalflow.example' }, getDb: () => db })
  const as = (method: string, path: string, body?: unknown) => alex.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  assert.equal((await as('POST', '/pulse/sources/tickets', {})).status, 403, 'an editor cannot designate a source')
  assert.equal((await as('POST', '/pulse/hubspot/check')).status, 403)
  assert.equal((await as('GET', '/pulse/hubspot')).status, 403)
  void pg
  void slug
})

test('the setup command checks a HubSpot key and portal id before it touches anything', async () => {
  // @ts-expect-error plain ESM helper
  const { buildRow } = await import('../db/set-integration.mjs')
  const env = { SETTINGS_ENCRYPTION_KEY: KEY }
  assert.deepEqual(buildRow(env, { kind: 'hubspot', secret: SERVICE_KEY, portalId: '4455667' }).config, { portalId: '4455667' })
  assert.deepEqual(buildRow(env, { kind: 'hubspot', secret: SERVICE_KEY }).config, {})
  assert.throws(() => buildRow(env, { kind: 'hubspot', secret: 'short' }), /service key/)
  assert.throws(() => buildRow(env, { kind: 'hubspot', secret: SERVICE_KEY, portalId: 'abc' }), /portal-id/)
})
