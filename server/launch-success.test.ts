// "How will we know it worked?": the launch's read-only success view. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { createDemoDatabase } from './test-utils.js'

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
  return { pg, call, owner: as('david'), alex: as('alex'), project }
}

test('the success view gathers the goals, each requirement’s measure and the review points from the target date; nothing before the requirements are published', async () => {
  const f = await fixture()
  const launch = await (await f.call(f.alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release', targetDate: '2027-01-28' })).json()
  const res = await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)
  assert.equal(res.status, 200)
  const d = await res.json()
  assert.equal(d.published, true)
  assert.equal(d.projectId, f.project)
  const requirements = (await f.pg.query<any>(`select count(*)::int n from delivery.stories where spec_id = (select id from delivery.specs where project_id = $1 and status = 'published') and kind = 'requirement'`, [f.project])).rows[0].n
  assert.equal(d.measures.length, requirements, 'one measure row for each requirement')
  assert.ok(Array.isArray(d.goals) && d.goals.length > 0, 'the goals come from the brief')
  assert.deepEqual(d.reviewPoints.map((p: any) => [p.label, p.on]), [['Launch', '2027-01-28'], ['30 days', '2027-02-27'], ['60 days', '2027-03-29'], ['90 days', '2027-04-28']])
  assert.equal(d.reviewer, 'Alex Rivera')

  // Returned to draft, there is no brief to measure.
  await f.pg.query(`update delivery.specs set status = 'draft', published_at = null where project_id = $1`, [f.project])
  const draft = await (await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)).json()
  assert.deepEqual([draft.published, draft.measures.length], [false, 0])
})

test('the success view is for people who can see the launch, never an external approver', async () => {
  const f = await fixture()
  const launch = await (await f.call(f.alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release' })).json()
  assert.equal((await f.call(f.owner, 'GET', `/launches/00000000-0000-4000-8000-000000000000/success`)).status, 404)
  const none = await (await f.call(f.owner, 'GET', `/launches/${launch.id}/success`)).json()
  assert.ok(none.reviewPoints.every((p: any) => p.on === null), 'no target date, no review dates')
})
