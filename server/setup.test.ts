// Workspace setup, the guided onboarding for owners: order, checks read from the workspace, done and skipped, owners only, audited. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
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
  const owner = as('david')
  return { pg, call, owner, alex: as('alex'), sam: as('sam'), reviewer: (who: string, steps: string[]) => setApprovers((m, p, b) => call(owner, m, p, b), who, steps) }
}

const statuses = (s: any) => s.categories.map((c: any) => `${c.key}:${c.status}`).join(' ')

test('setup is for owners; the categories come in order, the first current and the rest locked', async () => {
  const f = await fixture()
  assert.equal((await f.call(f.alex, 'GET', '/setup')).status, 403, 'an editor')
  assert.equal((await f.call(f.sam, 'GET', '/setup')).status, 403, 'a viewer')
  const s = await (await f.call(f.owner, 'GET', '/setup')).json()
  // terms:ignore (the category keys are identifiers)
  assert.equal(statuses(s), 'people:current approvals:locked categories:locked connections:locked guard:locked')
  assert.deepEqual([s.done, s.total, s.complete], [0, 5, false])
  assert.ok(s.categories[0].checks.length === 2)
  assert.equal(s.categories[4].checks.length, 0, 'the last one is read and confirmed, nothing to check')
})

test('a category is done when its checks pass; a later one stays locked; only an optional one can be skipped; each change is audited', async () => {
  const f = await fixture()
  const put = (step: string, status: string) => f.call(f.owner, 'PUT', `/setup/${step}`, { status })
  assert.equal((await put('approvals', 'done')).status, 409, 'locked until people is finished')
  assert.equal((await (await put('approvals', 'done')).json()).error.code, 'setup_locked')
  assert.equal((await put('people', 'skipped')).status, 422, 'people is not optional')
  assert.equal((await put('nowhere', 'done')).status, 404)

  // People: the demo workspace has several people and editors in each team.
  const people = (await (await f.call(f.owner, 'GET', '/setup')).json()).categories[0]
  assert.ok(people.checks.every((c: any) => c.ok), JSON.stringify(people.checks))
  // terms:ignore (the category keys are identifiers)
  assert.equal(statuses(await (await put('people', 'done')).json()), 'people:done approvals:current categories:locked connections:locked guard:locked')

  // Approvals are not done while a step has nobody; once every step has an approver they are.
  const approvals = (await (await f.call(f.owner, 'GET', '/setup')).json()).categories[1]
  if (!approvals.checks[0].ok) {
    const refused = await put('approvals', 'done')
    assert.equal(refused.status, 409)
    assert.equal((await refused.json()).error.code, 'setup_not_ready')
    await f.reviewer('alex', ['legal', 'sales', 'documentation', 'marketing'])
    await f.reviewer('david', ['product_leadership', 'final_decision'])
  }
  assert.equal((await put('approvals', 'done')).status, 200)

  // Categories: one is needed; a definition is good to have but never holds it back (the quick add and the suggestions make categories without one).
  const ws = ((await f.pg.query<any>(`select id from core.workspaces limit 1`)).rows[0] as { id: string }).id
  await f.pg.query(`update insights.feature_areas set definition = null`)
  assert.equal((await (await f.call(f.owner, 'GET', '/setup')).json()).categories[2].checks[0].ok, (await f.pg.query<any>(`select count(*)::int n from insights.feature_areas`)).rows[0].n >= 1)
  await f.pg.query(`insert into insights.feature_areas (workspace_id, name) values ($1, 'Booking and scheduling') on conflict do nothing`, [ws])
  const cats = (await (await f.call(f.owner, 'GET', '/setup')).json()).categories[2]
  assert.deepEqual(cats.checks.map((c: any) => [c.ok, c.required]), [[true, true], [false, false]], JSON.stringify(cats.checks))
  assert.equal((await put('categories', 'done')).status, 200, 'categories without definitions do not hold it back')

  // Connections are optional: skipped, even with nothing connected. The last is read and confirmed.
  // terms:ignore (the category keys are identifiers)
  assert.equal(statuses(await (await put('connections', 'skipped')).json()), 'people:done approvals:done categories:done connections:skipped guard:current')
  const end = await (await put('guard', 'done')).json()
  assert.deepEqual([end.done, end.complete], [5, true])
  const log = (await f.pg.query<any>(`select verb, after from core.audit_log where entity = 'core.workspace_setup' order by created_at`)).rows as { verb: string; after: { step: string } }[]
  assert.deepEqual(log.map((l) => `${l.verb}:${l.after.step}`), ['completed:people', 'completed:approvals', 'completed:categories', 'skipped:connections', 'completed:guard'])
})
