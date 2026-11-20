// Pulse (preview, slice 1): owners only and only while an owner has switched it on; customer signals added by hand or split out of notes, then kept or dismissed.
// Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { splitNotes } from './pulse.js'
import { fillDemoSignals, SAMPLES } from '../scripts/demo-pulse-signals.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

// The demo has David (owner), Alex (editor) and Sam (viewer). Each request is made as one person, with a new app so the identity cache never carries over.
async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  const as = (who?: string) => createApp({ env: { DEV_TOKEN: 's3cret', ...(who ? { DEV_USER_EMAIL: `${who}@demo.signalflow.example` } : {}) }, getDb: () => db })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { pg, db, as, call, owner: as(), alex: as('alex'), sam: as('sam') }
}

test('Pulse is off until an owner switches it on, and only an owner can see it even then', async () => {
  const { call, owner, alex, sam, pg } = await fixture()
  assert.equal((await (await call(owner, 'GET', '/me')).json()).features.pulse, false, 'off by default')
  assert.equal((await call(owner, 'GET', '/pulse/signals')).status, 404, 'off: even the owner gets "not found"')
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: 'x' })).status, 404)
  assert.deepEqual(await (await call(owner, 'GET', '/pulse/preview')).json(), { enabled: false })

  assert.equal((await call(alex, 'PUT', '/pulse/preview', { enabled: true })).status, 403, 'an editor cannot switch it on')
  assert.equal((await call(sam, 'PUT', '/pulse/preview', { enabled: true })).status, 403, 'neither can a viewer')
  assert.equal((await call(alex, 'GET', '/pulse/preview')).status, 403)
  assert.equal((await call(owner, 'PUT', '/pulse/preview', { enabled: 'yes' })).status, 422)

  assert.deepEqual(await (await call(owner, 'PUT', '/pulse/preview', { enabled: true })).json(), { enabled: true })
  assert.equal((await (await call(owner, 'GET', '/me')).json()).features.pulse, true)
  assert.equal((await call(owner, 'GET', '/pulse/signals')).status, 200)
  // On, but still invisible to everyone who is not an owner: the same answer as a page that does not exist.
  for (const who of [alex, sam]) {
    assert.equal((await (await call(who, 'GET', '/me')).json()).features.pulse, false)
    assert.equal((await call(who, 'GET', '/pulse/signals')).status, 404)
    assert.equal((await call(who, 'POST', '/pulse/signals', { body: 'x' })).status, 404)
    assert.equal((await call(who, 'POST', '/pulse/signals/import', { text: 'x' })).status, 404)
    assert.equal((await call(who, 'PATCH', '/pulse/signals/00000000-0000-0000-0000-000000000000', { status: 'kept' })).status, 404)
  }
  // The read-only demo visitor (no token) never sees it either.
  assert.equal((await owner.request('/api/v1/pulse/signals')).status, 404)

  await call(owner, 'PUT', '/pulse/preview', { enabled: false })
  assert.equal((await call(owner, 'GET', '/pulse/signals')).status, 404, 'switched off again')
  const audit = (await pg.query<any>(`select verb from core.audit_log where entity = 'core.workspace_features' order by created_at`)).rows.map((r: any) => r.verb)
  assert.deepEqual(audit, ['turned on', 'turned off'], 'the switch is audited')
})

test('signals: typed in (kept), split out of notes (new), then kept or dismissed; bad input is refused', async () => {
  const { call, owner } = await fixture()
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })

  const made = await call(owner, 'POST', '/pulse/signals', { body: '  Our CSMs do not trust the health score.  ', kind: 'complaint', saidBy: 'Marcus', account: 'Northwind', sourceLabel: 'Renewal call', occurredOn: '2026-11-18' })
  assert.equal(made.status, 201)
  const first = await made.json()
  assert.deepEqual([first.body, first.kind, first.source, first.status, first.saidBy, first.account, first.occurredOn], ['Our CSMs do not trust the health score.', 'complaint', 'manual', 'kept', 'Marcus', 'Northwind', '2026-11-18'])
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: '   ' })).status, 422, 'an empty signal is refused')
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: 'x', sourceUrl: 'javascript:alert(1)' })).status, 422, 'only http and https links')
  assert.equal((await call(owner, 'POST', '/pulse/signals', { body: 'x', occurredOn: '18/11/2026' })).status, 422, 'a date has to be a date')

  const imported = await call(owner, 'POST', '/pulse/signals/import', { text: '- Reports take too long to build by hand.\n- Handoffs to support lose context.\n- ok', sourceLabel: 'Call notes', account: 'Contoso' })
  assert.equal(imported.status, 201)
  assert.deepEqual(await imported.json(), { created: 2, skipped: 0 }, 'bullets are dropped, and a fragment too short to be a signal is left out')
  const list = await (await call(owner, 'GET', '/pulse/signals')).json()
  assert.deepEqual(list.counts, { new: 2, kept: 1, dismissed: 0 })
  const fromNotes = list.signals.filter((s: any) => s.source === 'notes')
  assert.deepEqual([fromNotes.length, fromNotes[0].status, fromNotes[0].sourceLabel, fromNotes[0].account], [2, 'new', 'Call notes', 'Contoso'])

  const dismissed = await call(owner, 'PATCH', `/pulse/signals/${fromNotes[0].id}`, { status: 'dismissed' })
  assert.equal((await dismissed.json()).status, 'dismissed')
  await call(owner, 'PATCH', `/pulse/signals/${fromNotes[1].id}`, { status: 'kept', kind: 'request' })
  const after = await (await call(owner, 'GET', '/pulse/signals')).json()
  assert.deepEqual(after.counts, { new: 0, kept: 2, dismissed: 1 })
  assert.equal((await (await call(owner, 'GET', '/pulse/signals?status=dismissed')).json()).signals.length, 1)
  assert.equal((await call(owner, 'GET', '/pulse/signals?status=bogus')).status, 422)
  assert.equal((await call(owner, 'PATCH', `/pulse/signals/${first.id}`, {})).status, 422, 'a change has to say what')
  assert.equal((await call(owner, 'PATCH', '/pulse/signals/not-an-id', { status: 'kept' })).status, 404)
})

test('notes are split by paragraph, or by line when there are no blank lines, and numbering is dropped', () => {
  assert.deepEqual(splitNotes('First point that is long enough.\nStill the same point.\n\nSecond point that is long enough.'), ['First point that is long enough. Still the same point.', 'Second point that is long enough.'])
  assert.deepEqual(splitNotes('1. One thing customers asked for.\n2) Another thing customers asked for.'), ['One thing customers asked for.', 'Another thing customers asked for.'])
  assert.deepEqual(splitNotes('   \n  '), [])
  assert.deepEqual(splitNotes('short'), [])
})

test('the sample-signals script fills Pulse with the Anchor CX story, and is safe to repeat', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  const dry = await fillDemoSignals(db, slug, false)
  assert.equal(dry.added, 0)
  assert.equal(((await pg.query<any>('select count(*)::int as n from core.pulse_signals')).rows[0] as { n: number }).n, 0, 'a dry run writes nothing')
  const run = await fillDemoSignals(db, slug, true)
  assert.equal(run.added, SAMPLES.length)
  const by = (await pg.query<any>(`select source, status, count(*)::int as n from core.pulse_signals group by 1, 2 order by 1, 2`)).rows
  assert.ok(by.some((r: any) => r.source === 'slack' && r.status === 'new'), 'some Slack signals wait for review')
  assert.ok(by.some((r: any) => r.source === 'notes' && r.status === 'kept'))
  assert.equal((await fillDemoSignals(db, slug, true)).added, 0, 'a second run adds nothing')
})
