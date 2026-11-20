// The demo-coverage script (scripts/demo-launch-coverage.ts) on the in-memory demo database: a dry run writes nothing, applying fills the three steps through the
// app's own functions, and a second run changes nothing. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { DEMO_STEPS, fillDemoLaunch } from '../scripts/demo-launch-coverage.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

test('the demo script fills Sales, Legal and Documentation with invented people and answers, and is safe to repeat', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  const slug = ((await pg.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  const project = 'Clinic booking, usability round 1'
  const app = createApp({ env: { DEV_TOKEN: 's3cret', DEV_USER_EMAIL: 'alex@demo.signalflow.example' }, getDb: () => db })
  const projectId = ((await pg.query<any>('select id from core.projects where name = $1', [project])).rows[0] as { id: string }).id
  const made = await app.request(`/api/v1/projects/${projectId}/launch`, { method: 'POST', headers, body: JSON.stringify({}) })
  assert.equal(made.status, 201)
  const launchId = (await made.json()).id as string
  const read = async () => (await (await app.request(`/api/v1/launches/${launchId}`, { headers })).json()) as { steps: { step: string; state: string }[] }
  const states = async () => Object.fromEntries((await read()).steps.map((s) => [s.step, s.state]))

  assert.equal((await states()).sales, 'missing')
  const dry = await fillDemoLaunch(db, slug, project, false)
  assert.equal(dry.changed, false)
  assert.equal((await states()).sales, 'missing', 'a dry run writes nothing')
  assert.equal(((await pg.query<any>(`select count(*)::int as n from core.users where email like '%.example' and email like '%anchorcx%'`)).rows[0] as { n: number }).n, 0)

  const run = await fillDemoLaunch(db, slug, project, true)
  assert.equal(run.changed, true)
  const after = await states()
  for (const s of DEMO_STEPS) assert.equal(after[s.step], 'ready', `${s.step} is answered ready`)
  assert.equal(after.marketing, 'missing', 'the other steps are not touched')
  assert.equal(after.product_leadership, 'missing')

  const again = await fillDemoLaunch(db, slug, project, true)
  assert.equal(again.changed, false, 'a second run changes nothing')
  const answers = ((await pg.query<any>(`select count(*)::int as n from delivery.launch_answers where launch_id = $1`, [launchId])).rows[0] as { n: number }).n
  assert.equal(answers, 3)
})
