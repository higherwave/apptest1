// How long things are kept, and legal holds. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { runRetention } from './retention.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const TOKEN = { DEV_TOKEN: 's3cret' }
const auth = { authorization: 'Bearer s3cret', 'content-type': 'application/json', 'if-match': '1' }
const MONTHS = (n: number) => `now() - interval '${n} months'`

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  await initWorkspace(pg, { name: 'Other', slug: 'other', owners: ['owner@other.example.test'] })
  const ids = Object.fromEntries((await pg.query<any>(`select slug, id from core.workspaces`)).rows.map((r: any) => [r.slug, r.id])) as Record<string, string>
  const as = (email: string, slug = 'higherwave-demo') => createApp({ env: { ...TOKEN, WORKSPACE_SLUG: slug, DEV_USER_EMAIL: email }, getDb: () => db })
  const call = (app: ReturnType<typeof as>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david@demo.signalflow.example')
  const editor = as('alex@demo.signalflow.example')
  const q = async (sql: string, p: unknown[] = []) => (await pg.query<any>(sql, p)).rows
  const count = async (sql: string, p: unknown[] = []) => (await q(sql, p))[0].n as number
  // Old and new rows in each place the cleanup looks.
  const seed = async (ws: string) => {
    await pg.query(`insert into core.audit_log (workspace_id, entity, entity_id, verb, created_at) values ($1, 'core.projects', gen_random_uuid(), 'old-entry', ${MONTHS(13)}), ($1, 'core.projects', gen_random_uuid(), 'new-entry', ${MONTHS(11)})`, [ws])
    await pg.query(`insert into core.ai_usage (workspace_id, purpose, provider, input_tokens, output_tokens, cost_usd, created_at) values ($1, 'analysis', 'old', 1, 1, 1, ${MONTHS(13)}), ($1, 'analysis', 'new', 1, 1, 1, ${MONTHS(11)})`, [ws])
  }
  const trashed = async (ws: string, daysAgo: number, name: string, project?: string) => {
    const rootId = project ?? (await q(`select gen_random_uuid() as id`))[0].id
    const payload = project ? { tables: { 'core.projects': [{ id: project }] } } : { tables: {} }
    await pg.query(`insert into core.trash (workspace_id, kind, root_table, root_id, name, purge_at, payload) values ($1, 'project', 'core.projects', $2, $3, now() + interval '${90 - daysAgo} days', $4)`, [ws, rootId, name, JSON.stringify(payload)])
    return rootId as string
  }
  return { pg, db, ids, as, call, owner, editor, q, count, seed, trashed }
}

test('the cleanup removes the audit log and AI usage older than 12 months and the Trash past 90 days, and keeps everything newer', async () => {
  const f = await fixture()
  await f.seed(f.ids['higherwave-demo'])
  await f.trashed(f.ids['higherwave-demo'], 91, 'Expired')
  await f.trashed(f.ids['higherwave-demo'], 30, 'Recent')
  const r = await runRetention(f.pg as any)
  assert.deepEqual([r.trashRemoved, r.auditRemoved >= 1, r.usageRemoved, r.paused], [1, true, 1, 0])
  assert.equal(await f.count(`select count(*)::int n from core.audit_log where verb = 'old-entry'`), 0)
  assert.equal(await f.count(`select count(*)::int n from core.audit_log where verb = 'new-entry'`), 1)
  assert.equal(await f.count(`select count(*)::int n from core.ai_usage where provider = 'old'`), 0)
  assert.equal(await f.count(`select count(*)::int n from core.ai_usage where provider = 'new'`), 1)
  assert.deepEqual((await f.q(`select name from core.trash order by name`)).map((x) => x.name), ['Recent'])
  const note = (await f.q(`select verb, before from core.audit_log where verb = 'removed after 90 days'`))[0]
  assert.ok(note, 'the removal is on the record')
  assert.equal((typeof note.before === 'string' ? JSON.parse(note.before) : note.before).name, 'Expired')
  // Running it again changes nothing.
  assert.deepEqual(await runRetention(f.pg as any).then((x) => [x.trashRemoved, x.auditRemoved, x.usageRemoved]), [0, 0, 0])
})

test('a message record older than a year keeps no content, only the marker that it was sent', async () => {
  const f = await fixture()
  const ws = f.ids['higherwave-demo']
  const user = (await f.q(`select id from core.users limit 1`))[0].id
  await f.pg.query(`insert into core.notifications (workspace_id, recipient_id, kind, dedupe_key, payload, status, error, created_at) values ($1, $2, 'launch.asked', 'k-old', '{"launchId":"x","step":"legal"}', 'sent', null, ${MONTHS(14)}), ($1, $2, 'launch.asked', 'k-failed', '{"a":1}', 'failed', 'smtp said no', ${MONTHS(14)}), ($1, $2, 'launch.asked', 'k-held', '{"a":1}', 'held', null, ${MONTHS(14)}), ($1, $2, 'launch.asked', 'k-new', '{"a":1}', 'sent', null, ${MONTHS(2)})`, [ws, user])
  const r = await runRetention(f.pg as any)
  assert.equal(r.notificationsCleared, 2)
  const row = async (k: string) => (await f.q(`select payload, status, error from core.notifications where dedupe_key = $1`, [k]))[0]
  for (const k of ['k-old', 'k-failed']) assert.deepEqual([(await row(k)).payload, (await row(k)).error], [{}, null], `${k} is a bare marker`)
  assert.equal((await row('k-old')).status, 'sent', 'the marker still says it was sent, so it is never sent twice')
  assert.deepEqual((await row('k-held')).payload, { a: 1 }, 'a message still waiting to go is left alone')
  assert.deepEqual((await row('k-new')).payload, { a: 1 })
})

test('legal holds: placed and released by owners only, one per scope, and on the record', async () => {
  const f = await fixture()
  const project = (await f.q(`select id, name from core.projects where kind = 'research' limit 1`))[0]
  assert.equal((await f.call(f.editor, 'GET', '/holds')).status, 403)
  assert.equal((await f.call(f.editor, 'POST', '/holds', { reason: 'Litigation' })).status, 403)
  assert.equal((await f.call(f.owner, 'POST', '/holds', { reason: 'x' })).status, 422, 'a reason is required')
  assert.equal((await f.call(f.owner, 'POST', '/holds', { projectId: '11111111-1111-4111-8111-111111111111', reason: 'Litigation' })).status, 404)
  const ws = await f.call(f.owner, 'POST', '/holds', { reason: 'Customer dispute 2026-11' })
  assert.equal(ws.status, 201)
  const wsHold = await ws.json()
  assert.deepEqual([wsHold.scope, wsHold.projectId, wsHold.scopeName, wsHold.reason, wsHold.releasedAt], ['workspace', null, 'Higherwave Demo', 'Customer dispute 2026-11', null])
  assert.ok(wsHold.setBy.name.length > 0)
  assert.equal((await f.call(f.owner, 'POST', '/holds', { reason: 'Again' })).status, 409, 'already held')
  const pr = await f.call(f.owner, 'POST', '/holds', { projectId: project.id, reason: 'Subpoena for this project' })
  assert.equal(pr.status, 201)
  assert.equal((await pr.json()).scopeName, project.name)
  const list = (await (await f.call(f.owner, 'GET', '/holds')).json()).data
  assert.equal(list.length, 2)
  const released = await f.call(f.owner, 'POST', `/holds/${wsHold.id}/release`)
  assert.equal(released.status, 200)
  assert.ok((await released.json()).releasedAt)
  assert.equal((await f.call(f.owner, 'POST', `/holds/${wsHold.id}/release`)).status, 404, 'cannot be released twice')
  const after = (await (await f.call(f.owner, 'GET', '/holds')).json()).data
  assert.deepEqual(after.map((h: any) => h.releasedAt === null), [true, false], 'in force first, then the history')
  const verbs = (await f.q(`select verb from core.audit_log where entity = 'core.legal_holds' order by created_at`)).map((x) => x.verb)
  assert.deepEqual(verbs, ['hold placed', 'hold placed', 'hold released'])
})

test('a hold on the workspace stops the cleanup and every permanent deletion; releasing it lets the cleanup go on', async () => {
  const f = await fixture()
  const ws = f.ids['higherwave-demo']
  await f.seed(ws)
  const p = (await f.q(`select id from core.projects where kind = 'research' limit 1`))[0].id
  const old = await f.trashed(ws, 100, 'Past its 90 days')
  const hold = await (await f.call(f.owner, 'POST', '/holds', { reason: 'Customer dispute' })).json()
  const r = await runRetention(f.pg as any)
  assert.deepEqual([r.trashRemoved, r.auditRemoved, r.usageRemoved, r.paused], [0, 0, 0, 1])
  assert.equal(await f.count(`select count(*)::int n from core.trash where root_id = $1`, [old]), 1, 'still in the Trash')
  assert.equal(await f.count(`select count(*)::int n from core.audit_log where verb = 'old-entry'`), 1, 'the old audit entry is kept')
  // Nobody can delete for good, by any route.
  const trashId = (await f.q(`select id from core.trash where root_id = $1`, [old]))[0].id
  for (const [method, path] of [['DELETE', `/projects/${p}?permanent=true`], ['DELETE', `/trash/${trashId}`], ['DELETE', `/workflows/${(await f.q(`insert into insights.workflows (workspace_id, name) values ($1, 'J') returning id`, [ws]))[0].id}?permanent=true`]] as const) {
    const res = await f.call(f.owner, method, path)
    assert.equal(res.status, 409, `${method} ${path}`)
    assert.equal((await res.json()).error.code, 'legal_hold')
  }
  assert.equal((await f.call(f.owner, 'DELETE', `/projects/${p}`)).status, 204, 'moving to the Trash is still allowed: nothing is destroyed')
  // Released: the cleanup carries on.
  await f.call(f.owner, 'POST', `/holds/${hold.id}/release`)
  const r2 = await runRetention(f.pg as any)
  assert.equal(r2.trashRemoved, 1)
  assert.ok(r2.auditRemoved >= 1 && r2.usageRemoved === 1)
  assert.equal((await f.call(f.owner, 'DELETE', `/trash/${(await f.q(`select id from core.trash limit 1`))[0].id}`)).status, 204)
})

test('a hold on one project protects that project’s Trash entry and its audit trail, not the others', async () => {
  const f = await fixture()
  const ws = f.ids['higherwave-demo']
  await f.seed(ws)
  const [a, b] = (await f.q(`select id from core.projects where kind = 'research' order by name limit 2`)).map((x) => x.id as string)
  await f.trashed(ws, 100, 'Held project', a)
  await f.trashed(ws, 100, 'Other project', b)
  await f.call(f.owner, 'POST', '/holds', { projectId: a, reason: 'Subpoena' })
  const r = await runRetention(f.pg as any)
  assert.equal(r.trashRemoved, 1, 'only the one that is not held')
  assert.deepEqual((await f.q(`select name from core.trash`)).map((x) => x.name), ['Held project'])
  assert.equal(r.auditRemoved, 0, 'any hold pauses the 12-month cleanup of the audit log, which is the evidence for it')
  assert.equal((await f.call(f.owner, 'DELETE', `/projects/${b}?permanent=true`)).status, 204, 'another project can still be deleted for good')
  assert.equal((await f.call(f.owner, 'DELETE', `/projects/${a}?permanent=true`)).status, 409)
  // A project that is in the Trash can be held too, so the hold and its entry stay together.
  await f.call(f.owner, 'DELETE', `/projects/${(await f.q(`select id from core.projects where kind = 'research' and id <> $1 limit 1`, [a]))[0].id}`)
  const inTrash = (await f.q(`select root_id from core.trash where name <> 'Held project' and name <> 'Other project' limit 1`))[0].root_id
  assert.equal((await f.call(f.owner, 'POST', '/holds', { projectId: inTrash, reason: 'Also this' })).status, 201)
})

test('one workspace’s hold never pauses another’s cleanup, and the cleanup of all workspaces is one run', async () => {
  const f = await fixture()
  await f.seed(f.ids['higherwave-demo'])
  await f.seed(f.ids.other)
  const theirs = f.as('owner@other.example.test', 'other')
  assert.equal((await f.call(theirs, 'POST', '/holds', { reason: 'Their matter' })).status, 201)
  const r = await runRetention(f.pg as any)
  assert.equal(r.paused, 1)
  const old = async (ws: string) => f.count(`select count(*)::int n from core.audit_log where workspace_id = $1 and verb = 'old-entry'`, [ws])
  assert.equal(await old(f.ids['higherwave-demo']), 0, 'the unheld workspace was cleaned')
  assert.equal(await old(f.ids.other), 1, 'the held workspace was not')
  // Their hold is theirs: ours cannot see it.
  assert.equal((await (await f.call(f.owner, 'GET', '/holds')).json()).data.length, 0)
})

test('the hourly job runs the cleanup and says what it did', async () => {
  const f = await fixture()
  await f.seed(f.ids['higherwave-demo'])
  const app = createApp({ env: { CRON_SECRET: 'cron-secret', DEV_USER_EMAIL: 'david@demo.signalflow.example' }, getDb: () => f.db })
  const res = await app.request('/api/v1/cron/digest', { headers: { authorization: 'Bearer cron-secret' } })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.retention.auditRemoved >= 1 && body.retention.usageRemoved === 1, JSON.stringify(body.retention))
  assert.equal(await f.count(`select count(*)::int n from core.ai_usage where provider = 'old'`), 0)
})

// @ts-expect-error plain ESM command-line tool
import { confirmation, inventory, removeWorkspace } from '../db/remove-workspace.mjs'

test('ending an agreement removes the whole workspace and the people who belonged only to it, refuses while a hold is in force, and leaves everyone else alone', async () => {
  const f = await fixture()
  await initWorkspace(f.pg, { name: 'Leaving Co', slug: 'leaving', owners: ['boss@leaving.example.test'] })
  const leaving = (await f.q(`select id from core.workspaces where slug = 'leaving'`))[0].id
  // One person belongs only to the leaving workspace; another belongs to it and to the demo workspace.
  const shared = (await f.q(`select id from core.users where email = 'alex@demo.signalflow.example'`))[0].id
  await f.pg.query(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, 'viewer')`, [leaving, shared])
  const team = (await f.q(`select id from core.teams where workspace_id = $1 and is_default`, [leaving]))[0].id
  await f.pg.query(`insert into core.projects (workspace_id, name, kind, team_id) values ($1, 'Their project', 'research', $2)`, [leaving, team])
  const before = {
    demoProjects: await f.count(`select count(*)::int n from core.projects where workspace_id = $1`, [f.ids['higherwave-demo']]),
    demoUsers: await f.count(`select count(*)::int n from core.users`),
  }
  const inv = await inventory(f.pg, 'leaving')
  assert.deepEqual([inv.counts.projects, inv.counts.members], [1, 2])
  await assert.rejects(removeWorkspace(f.pg, 'leaving', 'wrong'), /type it again/)
  await assert.rejects(removeWorkspace(f.pg, 'nope', 'nope'), /No workspace/)
  // A hold stops it.
  await f.pg.query(`insert into core.legal_holds (workspace_id, scope_name, reason) values ($1, 'Leaving Co', 'Dispute')`, [leaving])
  await assert.rejects(removeWorkspace(f.pg, 'leaving', 'leaving'), /legal hold/)
  assert.equal(await f.count(`select count(*)::int n from core.workspaces where slug = 'leaving'`), 1, 'nothing was removed')
  await f.pg.query(`update core.legal_holds set released_at = now() where workspace_id = $1`, [leaving])
  const r = await removeWorkspace(f.pg, 'leaving', 'leaving')
  assert.equal(r.peopleRemoved, 1, 'the boss, who belonged only there')
  assert.equal(await f.count(`select count(*)::int n from core.workspaces where slug = 'leaving'`), 0)
  for (const t of ['core.projects', 'core.teams', 'core.memberships', 'core.legal_holds']) assert.equal(await f.count(`select count(*)::int n from ${t} where workspace_id = $1`, [leaving]), 0, t)
  assert.equal(await f.count(`select count(*)::int n from core.users where email = 'boss@leaving.example.test'`), 0)
  assert.equal(await f.count(`select count(*)::int n from core.users where id = $1`, [shared]), 1, 'a person who belongs elsewhere stays')
  assert.equal(await f.count(`select count(*)::int n from core.projects where workspace_id = $1`, [f.ids['higherwave-demo']]), before.demoProjects, 'the other workspace is untouched')
  assert.equal(await f.count(`select count(*)::int n from core.users`), before.demoUsers - 1)
  const text = confirmation(r, new Date('2026-12-01T00:00:00Z'))
  assert.match(text, /1 projects/)
  assert.match(text, /2026-12-08/, 'the day the last database copy expires, a week later by default')
})

test('the audit log can be narrowed to changes since a moment, and a bad date is a 422', async () => {
  const f = await fixture()
  const ws = f.ids['higherwave-demo']
  await f.pg.query(`delete from core.audit_log where workspace_id = $1`, [ws])
  await f.pg.query(
    `insert into core.audit_log (workspace_id, entity, entity_id, verb, created_at) values ($1, 'core.projects', gen_random_uuid(), 'today-entry', now()), ($1, 'core.projects', gen_random_uuid(), 'last-week-entry', now() - interval '3 days'), ($1, 'core.projects', gen_random_uuid(), 'last-month-entry', now() - interval '20 days'), ($1, 'core.projects', gen_random_uuid(), 'old-entry', now() - interval '200 days')`,
    [ws],
  )
  const verbs = async (since?: string) => (await (await f.call(f.owner, 'GET', `/audit?limit=100${since ? `&since=${encodeURIComponent(since)}` : ''}`)).json()).data.map((e: any) => e.verb).sort()
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()
  assert.deepEqual(await verbs(), ['last-month-entry', 'last-week-entry', 'old-entry', 'today-entry'], 'no filter: everything')
  assert.deepEqual(await verbs(ago(1)), ['today-entry'])
  assert.deepEqual(await verbs(ago(7)), ['last-week-entry', 'today-entry'])
  assert.deepEqual(await verbs(ago(30)), ['last-month-entry', 'last-week-entry', 'today-entry'])
  assert.deepEqual(await verbs(ago(90)), ['last-month-entry', 'last-week-entry', 'today-entry'])
  assert.deepEqual(await verbs(new Date(Date.now() + 86_400_000).toISOString()), [], 'a moment in the future: nothing')
  const bad = await f.call(f.owner, 'GET', '/audit?since=yesterday-ish')
  assert.equal(bad.status, 422)
  assert.equal((await bad.json()).error.field, 'since')
  assert.equal((await f.call(f.editor, 'GET', `/audit?since=${encodeURIComponent(ago(1))}`)).status, 403, 'still owners only')
})
