// Measure's results: read-only, by theme, only measures that have been read. Run with: npm run test:api
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

test('Measure lists only measures that have a reading, under the themes of the requirements they cover, and nothing before there is one', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const as = (who: string) => createApp({ env: { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', DEV_USER_EMAIL: `${who}@acme-research.com` }, getDb: () => db, mailer: recordingMailer() })
  const [owner, alex] = [as('david'), as('alex')]
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    app.request(`/api/v1${path}`, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, { name: 'Spring release' })).json()

  const keys = (await pg.query<any>(`select st.key from delivery.stories st join delivery.specs sp on sp.id = st.spec_id where sp.project_id = $1 and sp.status = 'published' and st.kind = 'requirement' order by st.key`, [project])).rows.map((r) => r.key as string)
  const one = keys[0]
  const saved = await (await call(alex, 'PUT', `/launches/${launch.id}/measures`, { measures: [{ metricKind: 'adoption', comparison: 'reach', valueA: '40', unit: '%' }, { metricKind: 'engagement', comparison: 'above', valueA: '3', requirementKeys: [one] }, { metricKind: 'retention', comparison: 'reach', valueA: '80', unit: '%' }] }, { 'if-match': '0' })).json()
  const [adoption, engagement] = saved.measures
  assert.deepEqual((await (await call(owner, 'GET', '/measure/results')).json()).themes, [], 'measures with no reading are not shown')

  await setApprovers((m, p, b) => call(owner, m, p, b), 'david', ['final_decision'])
  assert.equal((await call(owner, 'PUT', `/launches/${launch.id}/steps/final_decision`, { answer: 'go' })).status, 200)
  assert.deepEqual((await (await call(owner, 'GET', '/measure/results')).json()).themes, [], 'a launch with no readings has nothing to show')

  await call(alex, 'PUT', `/launches/${launch.id}/measures/${adoption.id}/reading`, { on: '2027-03-01', value: '38', verdict: 'worked' })
  await call(alex, 'PUT', `/launches/${launch.id}/measures/${engagement.id}/reading`, { on: '2027-03-01', value: '2', verdict: 'needs_attention' })
  const res = await call(owner, 'GET', '/measure/results')
  assert.equal(res.status, 200)
  const { themes } = await res.json()
  assert.ok(themes.length > 0)
  const all = themes.flatMap((t: any) => t.projects.flatMap((p: any) => p.measures.map((m: any) => m.metricKind)))
  assert.ok(all.includes('adoption') && all.includes('engagement'), 'the two that were read are there')
  assert.ok(!all.includes('retention'), 'the one with no reading is not')
  // The release-wide measure is under every theme the release touches; the one that names a requirement is under that requirement's themes only.
  const under = (kind: string) => themes.filter((t: any) => t.projects.some((p: any) => p.measures.some((m: any) => m.metricKind === kind))).length
  assert.ok(under('adoption') >= under('engagement') && under('engagement') >= 1)
  const p0 = themes[0].projects[0]
  assert.deepEqual([p0.projectName, p0.launchName, p0.ownerName], ['Clinic booking, usability round 1', 'Spring release', 'Alex Rivera'])
  assert.ok(p0.approvedOn)
  assert.ok(themes[0].projects[0].measures[0].checkins.length >= 1 && themes[0].projects[0].measures[0].result)
})
