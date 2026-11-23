// "How will we know it worked?": the launch's read-only success view. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { sweepLaunch } from './launch-notices.js'
import { createDemoDatabase, setApprovers } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const as = (who: string) => createApp({ env: { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', DEV_USER_EMAIL: `${who}@acme-research.com` }, getDb: () => db, mailer: recordingMailer() })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  return { pg, db, call, owner: as('david'), alex: as('alex'), project }
}

test('the success view gathers the goals and the launch’s own measures; the review points wait for the final approval; nothing before the requirements are published', async () => {
  const f = await fixture()
  const launch = await (await f.call(f.alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release', targetDate: '2027-01-28' })).json()
  const res = await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)
  assert.equal(res.status, 200)
  const d = await res.json()
  assert.equal(d.published, true)
  assert.equal(d.projectId, f.project)
  assert.ok(Array.isArray(d.goals) && d.goals.length > 0, 'the goals come from the brief')
  assert.deepEqual([d.measures, d.measuresVersion, d.locked, d.approvedOn], [[], 0, false, null], 'a new launch has no measures yet')
  assert.deepEqual(d.reviewPoints.map((p: any) => [p.label, p.on]), [['30 days', null], ['60 days', null], ['90 days', null]], 'the target date does not start the clock')
  assert.equal(d.reviewer, 'Alex Rivera')

  // Returned to draft, there is no brief to measure.
  await f.pg.query(`update delivery.specs set status = 'draft', published_at = null where project_id = $1`, [f.project])
  const draft = await (await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)).json()
  assert.equal(draft.published, false)
})

test('an editor sets the launch’s measures as a short list, replaced as a whole against a version; they are fixed once the final decision is a go, and the clock starts then', async () => {
  const f = await fixture()
  const launch = await (await f.call(f.alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release' })).json()
  const url = `/launches/${launch.id}/measures`
  const put = (app: ReturnType<typeof createApp>, version: number, measures: unknown[]) =>
    app.request(`/api/v1${url}`, { method: 'PUT', headers: { ...headers, 'if-match': String(version) }, body: JSON.stringify({ measures }) })
  const adoption = { metricKind: 'adoption', detail: 'eligible accounts using booking', comparison: 'reach', valueA: '40', unit: '% within 60 days', requirementKeys: ['R1', 'R2'] }
  const engagement = { metricKind: 'engagement', comparison: 'above', valueA: '3', unit: 'bookings a week' }

  const first = await put(f.alex, 0, [adoption, engagement])
  assert.equal(first.status, 200)
  const d = await first.json()
  assert.deepEqual(d.measures.map((m: any) => [m.metricKind, m.valueA, m.requirementKeys]), [['adoption', '40', ['R1', 'R2']], ['engagement', '3', []]])
  assert.equal(d.measuresVersion, 1)

  // Order and ids are kept; a stale version is a conflict, not an overwrite.
  const keep = d.measures[1]
  const second = await (await put(f.alex, 1, [keep, adoption])).json()
  assert.deepEqual(second.measures.map((m: any) => m.metricKind), ['engagement', 'adoption'])
  assert.equal(second.measures[0].id, keep.id, 'a measure sent with its id keeps it')
  const stale = await put(f.alex, 1, [adoption])
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, 'version_conflict')
  assert.equal((await put(f.alex, 2, new Array(13).fill(adoption))).status, 422, 'a short list: at most twelve')
  assert.equal((await f.call(f.alex, 'PUT', url, { measures: [] })).status, 428, 'the version is required')

  // Not for someone who cannot edit the project's team.
  await f.pg.query(`update core.users set email = 'viewer@acme-research.com' where email like 'sam@%'`)
  await f.pg.query(`update core.team_memberships set role = 'viewer' where user_id = (select id from core.users where email = 'viewer@acme-research.com')`)
  const viewer = createApp({ env: { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', DEV_USER_EMAIL: 'viewer@acme-research.com' }, getDb: () => f.db, mailer: recordingMailer() })
  assert.equal((await put(viewer, 2, [adoption])).status, 403, 'a viewer cannot set the measures')

  // The final decision a go fixes the measures and starts the clock for the review points.
  await setApprovers((m, p, b) => f.call(f.owner, m, p, b), 'david', ['final_decision'])
  assert.equal((await f.call(f.owner, 'PUT', `/launches/${launch.id}/steps/final_decision`, { answer: 'go' })).status, 200)
  const after = await (await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)).json()
  assert.equal(after.locked, true)
  assert.match(after.approvedOn, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(after.reviewPoints.every((p: any) => p.on && p.on > after.approvedOn))
  const locked = await put(f.alex, after.measuresVersion, [adoption])
  assert.equal(locked.status, 409)
  assert.equal((await locked.json()).error.code, 'measures_locked')
  const audited = (await f.pg.query<any>(`select count(*)::int n from core.audit_log where entity_id = $1 and verb = 'expectations changed'`, [launch.id])).rows[0].n
  assert.equal(audited, 2, 'each save is in the audit log')
})

test('the success view is for people who can see the launch, never an external person', async () => {
  const f = await fixture()
  const launch = await (await f.call(f.alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release' })).json()
  assert.equal((await f.call(f.owner, 'GET', `/launches/00000000-0000-4000-8000-000000000000/success`)).status, 404)
  const none = await (await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)).json()
  assert.ok(none.reviewPoints.every((p: any) => p.on === null), 'no final approval, no review dates')
})

test('readings are recorded after the final go, one result per measure with the history kept; the owner is reminded at each point unless a reading was recorded since', async () => {
  const f = await fixture()
  const launch = await (await f.call(f.alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release' })).json()
  const saved = await (await f.owner.request(`/api/v1/launches/${launch.id}/measures`, { method: 'PUT', headers: { ...headers, 'if-match': '0' }, body: JSON.stringify({ measures: [{ metricKind: 'adoption', comparison: 'reach', valueA: '40', unit: '%' }, { metricKind: 'engagement', comparison: 'above', valueA: '3' }] }) })).json()
  const [adoption, engagement] = saved.measures
  const reading = (app: ReturnType<typeof createApp>, id: string, body: unknown) => f.call(app, 'PUT', `/launches/${launch.id}/measures/${id}/reading`, body)

  assert.equal((await reading(f.alex, adoption.id, { on: '2027-02-01', value: '12', verdict: 'too_early' })).status, 409, 'no readings before the final go')
  await setApprovers((m, p, b) => f.call(f.owner, m, p, b), 'david', ['final_decision'])
  assert.equal((await f.call(f.owner, 'PUT', `/launches/${launch.id}/steps/final_decision`, { answer: 'go' })).status, 200)
  const approvedOn = (await (await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)).json()).approvedOn as string
  const plus = (days: number) => { const d = new Date(`${approvedOn}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d }

  // The reminder at 30 days: once, to the owner, linking to the tab where readings are recorded.
  const mailer = recordingMailer()
  const env = { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test' } as never
  const workspaceId = ((await f.pg.query<any>(`select workspace_id from delivery.launches where id = $1`, [launch.id])).rows[0] as { workspace_id: string }).workspace_id
  const sweep = (at: Date) => sweepLaunch({ db: f.db, env, mailer, now: at }, workspaceId, launch.id)
  await sweep(plus(29))
  assert.equal(mailer.sent.length, 0, 'not due yet')
  await sweep(plus(31))
  await sweep(plus(31))
  const asked = mailer.sent.filter((m) => /30 days look/.test(m.subject))
  assert.equal(asked.length, 1, 'once per point')
  assert.deepEqual(asked.map((m) => m.to), ['alex@acme-research.com'])
  assert.match(asked[0].text, /\?tab=success/)

  // A reading: the newest day is the result, a second reading on the same day replaces it, and the history is kept.
  const r1 = await reading(f.alex, adoption.id, { on: '2027-02-01', value: '12', verdict: 'too_early', note: 'Early days' })
  assert.equal(r1.status, 200)
  const second = await (await reading(f.alex, adoption.id, { on: '2027-03-05', value: '31', verdict: 'worked' })).json()
  await reading(f.alex, adoption.id, { on: '2027-03-05', value: '33', verdict: 'worked' })
  const now = await (await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)).json()
  const a = now.measures.find((m: any) => m.id === adoption.id)
  assert.deepEqual(a.checkins.map((c: any) => [c.on, c.value]), [['2027-02-01', '12'], ['2027-03-05', '33']])
  assert.equal(a.result, 'worked')
  assert.equal(now.measures.find((m: any) => m.id === engagement.id).result, null)
  assert.equal(second.measures.length, 2)

  // A reading recorded since the last point means no reminder for the next one; with none, the next point asks.
  await f.pg.query(`update delivery.launch_measures set checkins = '[]'::jsonb where id = $1`, [adoption.id])
  await sweep(plus(61))
  assert.equal(mailer.sent.filter((m) => /60 days look/.test(m.subject)).length, 1, 'no reading since the 30 day point: asked again')
  await reading(f.alex, adoption.id, { on: plus(85).toISOString().slice(0, 10), value: '40', verdict: 'worked' })
  await sweep(plus(91))
  assert.equal(mailer.sent.filter((m) => /90 days look/.test(m.subject)).length, 0, 'a reading since the 60 day point: nothing to ask')

  // Not for someone who cannot edit the project's team; no such measure is a 404.
  await f.pg.query(`update core.users set email = 'viewer@acme-research.com' where email like 'sam@%'`)
  await f.pg.query(`update core.team_memberships set role = 'viewer' where user_id = (select id from core.users where email = 'viewer@acme-research.com')`)
  const viewer = createApp({ env: { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', DEV_USER_EMAIL: 'viewer@acme-research.com' }, getDb: () => f.db, mailer: recordingMailer() })
  assert.equal((await reading(viewer, adoption.id, { on: '2027-04-01', value: '1', verdict: 'worked' })).status, 403)
  assert.equal((await reading(f.alex, '00000000-0000-4000-8000-000000000000', { on: '2027-04-01', value: '1', verdict: 'worked' })).status, 404)
})
