// Measure across projects: every requirement of every project the caller can see, by the same team rules as Platform Insights.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const spec = parse(readFileSync(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'))
const TOKEN = { DEV_TOKEN: 's3cret' }
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

// The demo has David (owner), Alex (editor) and Sam (viewer), all in General, and the Clinic booking project with a published document. The
// Anchor CX demo adds three analysed projects, one of them ("Health score trust") with published requirements and measures.
async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  const as = (who?: string) => createApp({ env: { ...TOKEN, ...(who ? { DEV_USER_EMAIL: `${who}@demo.signalflow.example` } : {}) }, getDb: () => db })
  const get = (app: ReturnType<typeof createApp>, path = '/measure', authed = true) => app.request(`/api/v1${path}`, { headers: authed ? headers : {} })
  return { pg, db, as, get }
}

test('Measure lists every requirement of every project with a published document, each naming its project and team', async () => {
  const { as, get } = await fixture()
  const res = await get(as())
  assert.equal(res.status, 200)
  const body = await res.json()
  const names = body.projects.map((p: any) => p.name)
  assert.ok(names.includes('Health score trust') && names.includes('Clinic booking, usability round 1'), names.join())
  assert.deepEqual([...names], [...names].sort((a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })), 'projects by name')
  const health = body.items.filter((i: any) => i.projectName === 'Health score trust')
  assert.ok(health.length >= 5)
  assert.deepEqual(health.map((i: any) => i.key), [...health.map((i: any) => i.key)].sort((a: string, b: string) => Number(a.slice(1)) - Number(b.slice(1))), 'requirements in order')
  const r1 = health.find((i: any) => i.key === 'R1')
  assert.deepEqual([r1.metricKind, r1.result, r1.teamName], ['tickets', 'worked', 'General'])
  assert.deepEqual(r1.trend, [48, 44, 40, 29, 22, 11])
  assert.ok(body.items.every((i: any) => typeof i.projectId === 'string' && 'canEdit' in i))
  // The response matches the written API.
  const props = spec.components.schemas.MeasureAcrossItem.allOf[1].required as string[]
  assert.ok(props.every((k) => k in r1), 'every documented field is there')
})

test('a project of a team the caller is not in is hidden from them, and read-only for a leader who is not in it', async () => {
  const { pg, as, get } = await fixture()
  const ws = (await pg.query<any>(`select id from core.workspaces limit 1`)).rows[0].id
  const support = (await pg.query<any>(`insert into core.teams (workspace_id, name) values ($1, 'Support') returning id`, [ws])).rows[0].id
  await pg.query(`update core.projects set team_id = $1 where name = 'Health score trust'`, [support])
  const seen = async (who?: string) => (await (await get(as(who))).json()) as { projects: any[]; items: any[] }
  // Alex is an editor in General only: the Support project is not his to see.
  const alex = await seen('alex')
  assert.ok(!alex.projects.some((p) => p.name === 'Health score trust'))
  assert.ok(!alex.items.some((i) => i.projectName === 'Health score trust'))
  assert.ok(alex.projects.some((p) => p.name === 'Clinic booking, usability round 1'))
  // David is a leader: sees everything, and may change a row only where he edits (General, not Support).
  const david = await seen()
  const rows = (name: string) => david.items.filter((i) => i.projectName === name)
  assert.ok(rows('Health score trust').length > 0 && rows('Health score trust').every((i) => i.canEdit === false && i.teamName === 'Support'))
  assert.ok(rows('Clinic booking, usability round 1').every((i) => i.canEdit === true))
  // Sam is a viewer in General: sees General's projects, edits nothing.
  const sam = await seen('sam')
  assert.ok(sam.items.length > 0 && sam.items.every((i) => i.canEdit === false))
  assert.ok(!sam.projects.some((p) => p.name === 'Health score trust'))
})

test('the read-only demo viewer, with no token, sees every team and may change nothing', async () => {
  const { as, get } = await fixture()
  const res = await get(as(), '/measure', false)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.items.length > 0 && body.items.every((i: any) => i.canEdit === false))
})

test('a project with no published document has no rows, and a workspace with none answers an empty list', async () => {
  const { pg, as, get } = await fixture()
  await pg.query(`update delivery.specs set status = 'draft', published_at = null`)
  const body = await (await get(as())).json()
  assert.deepEqual(body, { projects: [], items: [] })
})

test('saving a row still goes through the requirement, and the page reads it back', async () => {
  const { as, get } = await fixture()
  const app = as()
  const before = await (await get(app)).json()
  const r3 = before.items.find((i: any) => i.projectName === 'Health score trust' && i.key === 'R3')
  const put = await app.request(`/api/v1/stories/${r3.storyId}/measure`, {
    method: 'PUT',
    headers: { ...headers, 'if-match': String(r3.version) },
    body: JSON.stringify({ ...r3, metric: null, source: 'kpi', baseline: null, target: null, checkins: [{ on: '2026-12-01', value: '12', verdict: 'worked', note: null }] }),
  })
  assert.equal(put.status, 200)
  const after = (await (await get(app)).json()).items.find((i: any) => i.storyId === r3.storyId)
  assert.deepEqual([after.result, after.checkins[0].value, after.version], ['worked', '12', r3.version + 1])
})
