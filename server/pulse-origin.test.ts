// Pulse: the Signals page's two views. Auto-discovered is what Pulse found by itself (Slack, Salesforce); Manual is what a person put in (typed, or call notes). Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { fillDemoSignals } from '../scripts/demo-pulse-signals.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

test('signals, topics and a topic’s quotes can be limited to what Pulse found or what a person put in; every number follows', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const call = (method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await call('PUT', '/pulse/preview', { enabled: true })
  await fillDemoSignals(db, slug, true)
  const all = await (await call('POST', '/pulse/topics/update', {})).json()

  const auto = await (await call('GET', '/pulse/signals?origin=auto')).json()
  const manual = await (await call('GET', '/pulse/signals?origin=manual')).json()
  const everything = await (await call('GET', '/pulse/signals')).json()
  assert.ok(auto.signals.length > 0 && manual.signals.length > 0)
  assert.ok(auto.signals.every((s: any) => s.source === 'slack' || s.source === 'salesforce'))
  assert.ok(manual.signals.every((s: any) => s.source === 'manual' || s.source === 'notes'))
  const total = (c: any) => c.new + c.kept + c.dismissed
  assert.equal(total(auto.counts) + total(manual.counts), total(everything.counts), 'the two views add up to everything')

  const autoTopics = (await (await call('GET', '/pulse/topics?origin=auto')).json()).topics
  const manualTopics = (await (await call('GET', '/pulse/topics?origin=manual')).json()).topics
  assert.ok(autoTopics.every((t: any) => Object.keys(t.channels).every((c) => c === 'slack' || c === 'salesforce')), 'only Slack and Salesforce evidence in the auto view')
  assert.ok(manualTopics.every((t: any) => Object.keys(t.channels).every((c) => c === 'call_notes')), 'only call notes in the manual view')
  for (const t of all.topics) {
    const a = autoTopics.find((x: any) => x.id === t.id)?.signals ?? 0
    const m = manualTopics.find((x: any) => x.id === t.id)?.signals ?? 0
    assert.equal(a + m, t.signals, `${t.title}: its signals split between the two views`)
  }
  assert.ok(all.topics.every((t: any) => Array.isArray(t.accounts)) && all.topics[0].accounts.length > 0, 'each topic lists its accounts')
  assert.equal(all.topics[0].accounts.reduce((n: number, a: any) => n + a.signals, 0) <= all.topics[0].signals, true)

  const t = autoTopics[0]
  const detail = await (await call('GET', `/pulse/topics/${t.id}?origin=auto`)).json()
  assert.equal(detail.quotes.length, t.signals, 'the quotes are the view’s own')
  assert.ok(detail.quotes.every((q: any) => q.channel === 'slack' || q.channel === 'salesforce'))
  assert.deepEqual(detail.accounts, t.accounts)
  const wholeDetail = await (await call('GET', `/pulse/topics/${t.id}`)).json()
  assert.ok(wholeDetail.quotes.length >= detail.quotes.length)
  assert.equal((await call('GET', '/pulse/signals?origin=both')).status, 422)
  assert.equal((await call('GET', '/pulse/topics?origin=nope')).status, 422)
})
