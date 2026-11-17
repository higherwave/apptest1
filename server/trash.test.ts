// The Trash: delete, restore and delete for good, for projects, documents and journeys. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { dataTables } from './export.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const TOKEN = { DEV_TOKEN: 's3cret' }
const auth = { authorization: 'Bearer s3cret', 'content-type': 'application/json', 'if-match': '1' }

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  const as = (email: string, slug = 'higherwave-demo') => createApp({ env: { ...TOKEN, WORKSPACE_SLUG: slug, DEV_USER_EMAIL: email }, getDb: () => db })
  const call = (app: ReturnType<typeof as>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david@demo.signalflow.example')
  const editor = as('alex@demo.signalflow.example')
  const viewer = as('sam@demo.signalflow.example')
  const ws = (await pg.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id as string
  // Everything the workspace holds, as comparable text, except what a delete or a restore changes on purpose.
  const EXCLUDE = new Set(['core.audit_log', 'core.trash', 'core.ai_usage', 'core.notifications'])
  const snapshot = async () => {
    const out: Record<string, string[]> = {}
    for (const t of await dataTables(pg as any)) {
      const key = `${t.schema}.${t.name}`
      if (EXCLUDE.has(key)) continue
      out[key] = (await pg.query<any>(`select (x::text) as r from ${key} x where workspace_id = $1`, [ws])).rows.map((r) => r.r as string).sort()
    }
    return out
  }
  return { pg, db, as, call, owner, editor, viewer, ws, snapshot }
}
const rich = async (f: Awaited<ReturnType<typeof fixture>>) => {
  // The project with the most going on: transcripts, themes, a document with stories, a launch with answers.
  const r = (await f.pg.query<any>(`select p.id, p.name from core.projects p where p.kind = 'research' and exists (select 1 from delivery.launches l where l.project_id = p.id) and exists (select 1 from research.themes t where t.project_id = p.id) order by (select count(*) from research.utterances u join research.transcripts tr on tr.id = u.transcript_id where tr.project_id = p.id) desc limit 1`)).rows[0]
  assert.ok(r, 'a rich project in the demo')
  return r as { id: string; name: string }
}

test('a deleted project goes to the Trash, vanishes from the app, and comes back exactly as it was', async () => {
  const f = await fixture()
  const p = await rich(f)
  const before = await f.snapshot()
  const rows = (b: Record<string, string[]>) => Object.values(b).reduce((n, r) => n + r.length, 0)

  const del = await f.call(f.owner, 'DELETE', `/projects/${p.id}`)
  assert.equal(del.status, 204)
  assert.equal((await f.call(f.owner, 'GET', `/projects/${p.id}`)).status, 404, 'gone from the app')
  assert.ok(!(await (await f.call(f.owner, 'GET', '/projects')).json()).data.some((x: any) => x.id === p.id))
  const during = await f.snapshot()
  assert.ok(rows(during) < rows(before) - 20, 'everything under it left the live tables too')
  assert.equal((await f.pg.query<any>(`select count(*)::int n from research.utterances u join research.transcripts t on t.id = u.transcript_id where t.project_id = $1`, [p.id])).rows[0].n, 0)

  const list = await (await f.call(f.owner, 'GET', '/trash')).json()
  assert.equal(list.retentionDays, 90)
  assert.equal(list.data.length, 1)
  const item = list.data[0]
  assert.equal(item.name, p.name)
  assert.equal(item.kind, 'project')
  assert.equal(item.daysLeft, 90)
  assert.ok(item.summary.transcripts > 0 && item.summary.themes > 0, JSON.stringify(item.summary))
  assert.equal(item.deletedBy.name.length > 0, true)

  const back = await f.call(f.owner, 'POST', `/trash/${item.id}/restore`)
  assert.equal(back.status, 200)
  const restored = await back.json()
  assert.deepEqual([restored.name, restored.kind, restored.leftOut], [p.name, 'project', 0])
  assert.equal((await (await f.call(f.owner, 'GET', '/trash')).json()).data.length, 0, 'out of the Trash')
  const after = await f.snapshot()
  for (const table of Object.keys(before)) assert.deepEqual(after[table], before[table], `${table} is exactly as it was`)
  assert.equal((await f.call(f.owner, 'GET', `/projects/${p.id}`)).status, 200)
  const verbs = (await f.pg.query<any>(`select verb from core.audit_log where entity_id = $1 order by created_at`, [p.id])).rows.map((r) => r.verb)
  assert.deepEqual(verbs.filter((v: string) => ['deleted', 'restored'].includes(v)), ['deleted', 'restored'])
})

test('who may delete, see, restore and remove for good', async () => {
  const f = await fixture()
  const [a, b] = (await f.pg.query<any>(`select id, name from core.projects where kind = 'research' order by name limit 2`)).rows
  // An editor moves one to the Trash; the owner moves another.
  assert.equal((await f.call(f.editor, 'DELETE', `/projects/${a.id}`)).status, 204)
  assert.equal((await f.call(f.owner, 'DELETE', `/projects/${b.id}`)).status, 204)
  const ownerSees = (await (await f.call(f.owner, 'GET', '/trash')).json()).data
  assert.deepEqual(ownerSees.map((x: any) => x.name).sort(), [a.name, b.name].sort(), 'an owner sees everything')
  const editorSees = (await (await f.call(f.editor, 'GET', '/trash')).json()).data
  assert.deepEqual(editorSees.map((x: any) => x.name), [a.name], 'an editor sees what they deleted')
  assert.deepEqual((await (await f.call(f.viewer, 'GET', '/trash')).json()).data, [], 'a viewer sees nothing')
  const mine = editorSees[0].id
  const others = ownerSees.find((x: any) => x.name === b.name).id
  // An editor restores their own, not someone else's, and cannot remove anything for good.
  assert.equal((await f.call(f.editor, 'POST', `/trash/${others}/restore`)).status, 404, 'not theirs: the same answer as for one that does not exist')
  assert.equal((await f.call(f.viewer, 'POST', `/trash/${mine}/restore`)).status, 403)
  assert.equal((await f.call(f.editor, 'DELETE', `/trash/${mine}`)).status, 403, 'only an owner removes for good')
  assert.equal((await f.call(f.editor, 'POST', `/trash/${mine}/restore`)).status, 200)
  // Deleting for good: an owner's decision, with no way back.
  assert.equal((await f.call(f.editor, 'DELETE', `/projects/${a.id}?permanent=true`)).status, 403)
  assert.equal((await f.call(f.owner, 'DELETE', `/trash/${others}`)).status, 204)
  assert.equal((await f.call(f.owner, 'POST', `/trash/${others}/restore`)).status, 404)
  assert.equal((await f.call(f.owner, 'DELETE', `/projects/${a.id}?permanent=true`)).status, 204)
  assert.equal((await (await f.call(f.owner, 'GET', '/trash')).json()).data.length, 0, 'nothing held: both were removed for good')
  assert.equal((await f.pg.query<any>(`select count(*)::int n from core.projects where id = any($1::uuid[])`, [[a.id, b.id]])).rows[0].n, 0)
  const verbs = (await f.pg.query<any>(`select verb from core.audit_log where verb like 'deleted%' order by created_at`)).rows.map((r) => r.verb)
  assert.deepEqual(verbs, ['deleted', 'deleted', 'deleted permanently', 'deleted permanently'], 'the log says which was which')
})

test('restoring is refused when something with that identity is already there, and copes with links to things removed in the meantime', async () => {
  const f = await fixture()
  const p = await rich(f)
  await f.call(f.owner, 'DELETE', `/projects/${p.id}`)
  const id = (await (await f.call(f.owner, 'GET', '/trash')).json()).data[0].id
  // Something with the same id appears: restoring over it is refused, and nothing is lost.
  const team = (await f.pg.query<any>(`select id from core.teams where workspace_id = $1 and is_default`, [f.ws])).rows[0].id
  await f.pg.query(`insert into core.projects (id, workspace_id, name, kind, team_id) values ($1, $2, 'Squatter', 'research', $3)`, [p.id, f.ws, team])
  assert.equal((await f.call(f.owner, 'POST', `/trash/${id}/restore`)).status, 409)
  assert.equal((await (await f.call(f.owner, 'GET', '/trash')).json()).data.length, 1, 'still in the Trash')
  await f.pg.query(`delete from core.projects where id = $1`, [p.id])
  // A platform theme the project's themes were rolled up into is removed while it is in the Trash: the rows that pointed at it are left out, the rest returns.
  const gone = (await f.pg.query<any>(`select distinct platform_theme_id from insights.platform_theme_sources`)).rows
  const projectSources = (await f.pg.query<any>(`select count(*)::int n from insights.platform_theme_sources s join research.themes t on t.id = s.theme_id where t.project_id = $1`, [p.id])).rows[0].n
  assert.equal(projectSources, 0, 'its rollup links left with it')
  assert.ok(gone.length > 0)
  await f.pg.query(`delete from insights.platform_themes`)
  const res = await f.call(f.owner, 'POST', `/trash/${id}/restore`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.ok(body.leftOut > 0, `${body.leftOut} rollup links could not return, and the project did`)
  assert.equal((await f.call(f.owner, 'GET', `/projects/${p.id}`)).status, 200)
})

test('a requirements document, a stand-alone document and a journey each go to the Trash and come back whole', async () => {
  const f = await fixture()
  const before = await f.snapshot()
  // A document of a project.
  const spec = (await f.pg.query<any>(`select s.id, s.name from delivery.specs s join core.projects p on p.id = s.project_id where p.kind = 'research' and exists (select 1 from delivery.stories st where st.spec_id = s.id) limit 1`)).rows[0]
  assert.equal((await f.call(f.owner, 'DELETE', `/specs/${spec.id}`)).status, 409, 'published requirements are locked')
  await f.pg.query(`update delivery.specs set status = 'draft', published_at = null where id = $1`, [spec.id]) // returned to draft
  assert.equal((await f.call(f.owner, 'DELETE', `/specs/${spec.id}`)).status, 204)
  assert.equal((await f.pg.query<any>(`select count(*)::int n from delivery.stories where spec_id = $1`, [spec.id])).rows[0].n, 0)
  let item = (await (await f.call(f.owner, 'GET', '/trash')).json()).data[0]
  assert.deepEqual([item.kind, item.name], ['document', spec.name])
  assert.equal((await f.call(f.owner, 'POST', `/trash/${item.id}/restore`)).status, 200)
  // A journey with projects on it.
  const wf = (await f.pg.query<any>(`insert into insights.workflows (workspace_id, name) values ($1, 'Onboarding journey') returning id, name`, [f.ws])).rows[0]
  await f.pg.query(`insert into insights.workflow_stages (workspace_id, workflow_id, position, name) values ($1, $2, 0, 'Sign up'), ($1, $2, 1, 'First win')`, [f.ws, wf.id])
  const onIt = (await f.pg.query<any>(`select id from core.projects where kind = 'research' and not exists (select 1 from insights.project_workflows pw where pw.project_id = core.projects.id) limit 1`)).rows[0].id
  await f.pg.query(`insert into insights.project_workflows (project_id, workspace_id, workflow_id) values ($1, $2, $3)`, [onIt, f.ws, wf.id])
  const before2 = await f.snapshot()
  assert.equal((await f.call(f.owner, 'DELETE', `/workflows/${wf.id}`)).status, 204)
  assert.equal((await f.pg.query<any>(`select count(*)::int n from insights.project_workflows where workflow_id = $1`, [wf.id])).rows[0].n, 0)
  item = (await (await f.call(f.owner, 'GET', '/trash')).json()).data[0]
  assert.deepEqual([item.kind, item.name], ['journey', wf.name])
  assert.equal((await f.call(f.owner, 'POST', `/trash/${item.id}/restore`)).status, 200)
  const after = await f.snapshot()
  for (const table of Object.keys(before2)) assert.deepEqual(after[table], before2[table], `${table} is exactly as it was`)
  assert.equal(Object.keys(before).length, Object.keys(before2).length)
})

test('the Trash of one workspace is invisible to another, and the snapshot never leaves its workspace', async () => {
  const f = await fixture()
  await initWorkspace(f.pg, { name: 'Other', slug: 'other', owners: ['owner@other.example.test'] })
  const theirs = f.as('owner@other.example.test', 'other')
  const p = await rich(f)
  await f.call(f.owner, 'DELETE', `/projects/${p.id}`)
  const id = (await (await f.call(f.owner, 'GET', '/trash')).json()).data[0].id
  assert.deepEqual((await (await f.call(theirs, 'GET', '/trash')).json()).data, [], 'their list is empty')
  assert.equal((await f.call(theirs, 'POST', `/trash/${id}/restore`)).status, 404)
  assert.equal((await f.call(theirs, 'DELETE', `/trash/${id}`)).status, 404)
  assert.equal((await (await f.call(f.owner, 'GET', '/trash')).json()).data.length, 1, 'still there for its owner')
})

test('a stand-alone document owns its project: deleting it moves both to the Trash, and restoring brings both back', async () => {
  const f = await fixture()
  const res = await f.call(f.owner, 'POST', '/specs/standalone', { name: 'Saved searches', what: 'Let people save a search and get alerts' })
  assert.equal(res.status, 201)
  const spec = await res.json()
  const specId = spec.id as string
  const projectId = (await f.pg.query<any>(`select project_id from delivery.specs where id = $1`, [specId])).rows[0].project_id as string
  const before = await f.snapshot()
  assert.equal((await f.call(f.owner, 'DELETE', `/specs/${specId}`)).status, 204)
  assert.equal((await f.pg.query<any>(`select count(*)::int n from core.projects where id = $1`, [projectId])).rows[0].n, 0, 'its project is gone too')
  const item = (await (await f.call(f.owner, 'GET', '/trash')).json()).data[0]
  assert.deepEqual([item.kind, item.name], ['document', 'Saved searches'])
  assert.equal((await f.call(f.owner, 'POST', `/trash/${item.id}/restore`)).status, 200)
  const after = await f.snapshot()
  for (const table of Object.keys(before)) assert.deepEqual(after[table], before[table], `${table} is exactly as it was`)
  assert.equal((await f.pg.query<any>(`select count(*)::int n from delivery.specs where id = $1`, [specId])).rows[0].n, 1)
})
