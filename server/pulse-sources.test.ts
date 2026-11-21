// Pulse slice 4: designated Slack channels. Only a listed channel is read; each has a mode (keep or review); reading twice never doubles; problems stay on the source.
// Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { recordingSlack } from './slack-recorder.js'
import { plainSlackText, usableMessage } from './pulse-sources.js'
import { runPulseUpdates } from './pulse.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const NOW = Math.floor(Date.now() / 1000)
const msg = (n: number, text: string, extra: Record<string, unknown> = {}) => ({ ts: `${NOW - 3600 + n}.000100`, text, user: 'U1', bot: false, subtype: null, ...extra })

async function fixture(opts: { live?: boolean } = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  const rec = recordingSlack(opts)
  const as = (who?: string) => createApp({ env: { DEV_TOKEN: 's3cret', ...(who ? { DEV_USER_EMAIL: `${who}@demo.signalflow.example` } : {}) }, getDb: () => db, slack: rec.slack })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as()
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  return { pg, db, rec, call, owner, alex: as('alex'), sam: as('sam') }
}

test('Slack text becomes plain words, and only messages from people count', () => {
  assert.equal(plainSlackText('<@U123> the <https://x.test/a|renewal page> is slow &amp; <#C1|support> knows <!here>'), 'the renewal page is slow & #support knows')
  assert.equal(usableMessage(msg(1, 'Customers keep asking where the export went')), 'Customers keep asking where the export went')
  assert.equal(usableMessage(msg(1, 'ok thanks')), null, 'too short to be a signal')
  assert.equal(usableMessage(msg(1, 'A bot posted a long message here', { bot: true })), null)
  assert.equal(usableMessage(msg(1, 'someone joined the channel today', { subtype: 'channel_join' })), null)
})

test('sources: owners only, while the preview is on; a channel must exist; each is audited', async () => {
  const { call, owner, alex, sam, pg } = await fixture()
  for (const [who, status] of [[alex, 403], [sam, 404]] as const) {
    assert.equal((await call(who, 'GET', '/pulse/sources')).status, status, 'sources are the owner\'s: an editor is refused, a viewer sees nothing')
    assert.equal((await call(who, 'POST', '/pulse/sources', { name: 'customer-feedback' })).status, status)
  }
  assert.equal((await owner.request('/api/v1/pulse/sources')).status, 404, 'the read-only visitor never sees it')
  assert.deepEqual(await (await call(owner, 'GET', '/pulse/sources')).json(), { sources: [], slackConnected: true })

  assert.equal((await call(owner, 'POST', '/pulse/sources', { name: 'Bad Name!' })).status, 422)
  assert.equal((await call(owner, 'POST', '/pulse/sources', { name: 'missing-channel' })).status, 422, 'Slack cannot find it')
  const made = await call(owner, 'POST', '/pulse/sources', { name: '#Customer-Feedback' })
  assert.equal(made.status, 201)
  const src = await made.json()
  assert.equal(src.name, 'customer-feedback')
  assert.equal(src.mode, 'review', 'review is the safe default')
  assert.equal(src.channel, 'slack')
  assert.equal((await call(owner, 'POST', '/pulse/sources', { name: 'customer-feedback' })).status, 422, 'no duplicates')

  const changed = await (await call(owner, 'PATCH', `/pulse/sources/${src.id}`, { mode: 'keep', channel: 'call_notes' })).json()
  assert.equal(changed.mode, 'keep')
  assert.equal(changed.channel, 'call_notes')
  assert.equal((await call(owner, 'PATCH', `/pulse/sources/${src.id}`, { channel: 'support_tickets' })).status, 422, 'the older channels are gone')
  assert.equal((await call(owner, 'PATCH', `/pulse/sources/${src.id}`, {})).status, 422)
  assert.equal((await call(owner, 'DELETE', `/pulse/sources/${src.id}`)).status, 204)
  assert.equal((await call(owner, 'DELETE', `/pulse/sources/${src.id}`)).status, 404)
  const verbs = (await pg.query<any>(`select verb from core.audit_log where entity = 'core.pulse_sources' order by created_at`)).rows.map((r: any) => r.verb)
  assert.deepEqual(verbs, ['added', 'changed', 'removed'])
})

test('reading a channel: review mode waits, keep mode counts, a second read adds nothing, bots and joins are left out', async () => {
  const { call, owner, rec, pg } = await fixture()
  rec.feeds['C_customer-feedback'] = [
    msg(1, 'Customers keep asking where the weekly digest went'),
    msg(2, 'A scheduled reminder from the bot goes here', { bot: true }),
    msg(3, 'joined', { subtype: 'channel_join' }),
    msg(4, 'The renewal page is confusing for new admins'),
  ]
  const review = await (await call(owner, 'POST', '/pulse/sources', { name: 'customer-feedback' })).json()
  let res = await (await call(owner, 'POST', `/pulse/sources/${review.id}/check`)).json()
  assert.deepEqual(res, { added: 2, error: null })
  let rows = (await pg.query<any>(`select status, source, source_label, channel from core.pulse_signals where source = 'slack'`)).rows
  assert.equal(rows.length, 2)
  assert.ok(rows.every((r: any) => r.status === 'new' && r.source_label === '#customer-feedback' && r.channel === 'slack'))

  assert.deepEqual(await (await call(owner, 'POST', `/pulse/sources/${review.id}/check`)).json(), { added: 0, error: null }, 'the same messages are never read twice')
  rec.feeds['C_customer-feedback'].push(msg(5, 'Support says the handoff notes get lost between teams'))
  assert.equal((await (await call(owner, 'POST', `/pulse/sources/${review.id}/check`)).json()).added, 1, 'only the new message')

  await call(owner, 'PATCH', `/pulse/sources/${review.id}`, { mode: 'keep' })
  rec.feeds['C_customer-feedback'].push(msg(6, 'Another customer wants the digest by email on Mondays'))
  await call(owner, 'POST', `/pulse/sources/${review.id}/check`)
  rows = (await pg.query<any>(`select status, kept_at from core.pulse_signals where source = 'slack' order by created_at`)).rows
  assert.equal(rows.at(-1).status, 'kept')
  assert.ok(rows.at(-1).kept_at, 'a kept signal has a kept time, so it counts as new since the last update')
  const list = await (await call(owner, 'GET', '/pulse/sources')).json()
  assert.equal(list.sources[0].lastAdded, 1)
  assert.equal(list.sources[0].lastError, null)
  assert.ok(list.sources[0].lastCheckedAt)
})

test('a Slack problem stays on the source and fails nothing', async () => {
  const { call, owner, rec } = await fixture()
  const src = await (await call(owner, 'POST', '/pulse/sources', { name: 'customer-feedback' })).json()
  rec.state.historyError = 'missing_scope'
  const res = await (await call(owner, 'POST', `/pulse/sources/${src.id}/check`)).json()
  assert.equal(res.added, 0)
  assert.match(res.error, /permission/)
  const list = await (await call(owner, 'GET', '/pulse/sources')).json()
  assert.match(list.sources[0].lastError, /permission/)
  rec.state.historyError = null
  assert.equal((await (await call(owner, 'POST', `/pulse/sources/${src.id}/check`)).json()).error, null, 'it recovers on the next read')
})

test('without a Slack connection a channel is saved and says so when checked', async () => {
  const { call, owner } = await fixture({ live: false })
  assert.equal((await (await call(owner, 'GET', '/pulse/sources')).json()).slackConnected, false)
  const src = await (await call(owner, 'POST', '/pulse/sources', { name: 'customer-feedback' })).json()
  const res = await (await call(owner, 'POST', `/pulse/sources/${src.id}/check`)).json()
  assert.deepEqual(res, { added: 0, error: 'Slack is not connected yet.' })
})

test('the hourly job reads enabled sources before grouping, and skips a switched-off one', async () => {
  const { call, owner, rec, db, pg } = await fixture()
  rec.feeds['C_customer-feedback'] = [msg(1, 'Customers keep asking where the weekly digest went'), msg(2, 'The weekly digest never arrives for our admins')]
  rec.feeds['C_quiet'] = [msg(1, 'Nobody should ever read this channel at all')]
  const a = await (await call(owner, 'POST', '/pulse/sources', { name: 'customer-feedback', mode: 'keep' })).json()
  const b = await (await call(owner, 'POST', '/pulse/sources', { name: 'quiet', mode: 'keep' })).json()
  await call(owner, 'PATCH', `/pulse/sources/${b.id}`, { enabled: false })
  const result = await runPulseUpdates(db, async () => rec.slack)
  assert.equal(result.read, 2)
  const topics = await (await call(owner, 'GET', '/pulse/topics')).json()
  assert.ok(topics.topics.some((t: any) => t.signals >= 2 || t.signalCount >= 2), 'the two kept messages were grouped in the same run')
  assert.equal(Number((await pg.query<any>(`select count(*)::int as n from core.pulse_signals where body like 'Nobody%'`)).rows[0].n), 0)
  assert.ok(a.id)
})

test('finding a channel falls back to public ones when the app lacks the private-channel permission', async () => {
  const { makeSlack } = await import('./slack.js')
  const seen: string[] = []
  const slack = makeSlack({ SLACK_BOT_TOKEN: 'xoxb-test' }, async (url) => {
    const types = new URL(url).searchParams.get('types') ?? ''
    seen.push(types)
    return types.includes('private') ? new Response(JSON.stringify({ ok: false, error: 'missing_scope' })) : new Response(JSON.stringify({ ok: true, channels: [{ id: 'C9', name: 'customer-feedback' }] }))
  })
  assert.equal(await slack.findChannel('customer-feedback'), 'C9')
  assert.deepEqual(seen, ['public_channel,private_channel', 'public_channel'])
  await assert.rejects(slack.findChannel('nope'), /Slack cannot find that channel/)
})
