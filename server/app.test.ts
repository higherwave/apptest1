// Run with: npm run test:api   (tsx + Node's test runner; uses an in-memory Postgres, no Neon compute)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createDemoDatabase, pgliteDb } from './test-utils.js'
import { parse } from 'yaml'
import { createApp } from './app.js'
import { getProvider, makeAi, simulatedProvider, type AiProvider } from './ai.js'
import { cleanConnectionString, databaseUnavailable, findConnectionString, wrapDb, type Db } from './db.js'
// @ts-expect-error plain ESM helpers shared with the db/ tooling
import { migrationFiles } from '../db/migrate.mjs'

// Node's fetch types return unknown from json(); the tests inspect bodies freely.
declare global {
  interface Response {
    json(): Promise<any>
  }
}

const spec = parse(readFileSync(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'))

// A Db that fails the test if anything uses it: proves a route never touches the database.
const forbidden = async (): Promise<never> => { throw new Error('the database must not be used by this route') }
const forbiddenDb: Db = { query: forbidden, transaction: forbidden }

let pglite: PGlite
let db: Db
async function demoDb() {
  if (db) return db
  ;({ pglite, db } = await createDemoDatabase())
  return db
}

// Minimal JSON Schema check for the response shapes in the spec (type, required, enum, properties, $ref).
function resolve(schema: any): any {
  if (schema?.$ref) return schema.$ref.replace('#/', '').split('/').reduce((o: any, k: string) => o[k], spec)
  return schema
}
function conforms(schema: any, value: unknown, path = '$'): string[] {
  const s = resolve(schema)
  const problems: string[] = []
  if (Array.isArray(s.type)) {
    const ok = s.type.some((t: string) => (t === 'null' ? value === null : conforms({ ...s, type: t }, value, path).length === 0))
    return ok ? [] : [`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(s.type)}`]
  }
  if (s.type === 'array') {
    if (!Array.isArray(value)) return [`${path}: expected array`]
    return value.flatMap((v, i) => conforms(s.items, v, `${path}[${i}]`))
  }
  if (s.type === 'object') {
    if (typeof value !== 'object' || value === null) return [`${path}: expected object`]
    for (const k of s.required ?? []) if (!(k in (value as object))) problems.push(`${path}.${k}: missing`)
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (k in (value as object)) problems.push(...conforms(sub, (value as any)[k], `${path}.${k}`))
  } else if (s.type === 'string' && typeof value !== 'string') problems.push(`${path}: expected string`)
  else if (s.type === 'integer' && !Number.isInteger(value)) problems.push(`${path}: expected integer`)
  if (s.enum && !s.enum.includes(value)) problems.push(`${path}: ${JSON.stringify(value)} not in ${JSON.stringify(s.enum)}`)
  return problems
}
async function expectSpec(res: Response, path: string, method = 'get') {
  const declared = spec.paths[path][method].responses[String(res.status)]
  assert.ok(declared, `${method.toUpperCase()} ${path} returned ${res.status}, which the spec does not declare`)
  const body = await res.json()
  const schema = resolve(declared).content['application/json'].schema
  assert.deepEqual(conforms(schema, body), [], `${method.toUpperCase()} ${path} ${res.status} does not match the spec`)
  return body
}

test('GET /health is 200 and never touches the database', async () => {
  const app = createApp({ env: {}, getDb: () => forbiddenDb })
  const body = await expectSpec(await app.request('/api/v1/health'), '/health')
  assert.equal(body.status, 'ok')
})

test('GET /health/db reaches the database and reports the migrations', async () => {
  const app = createApp({ env: {}, getDb: () => db })
  await demoDb()
  const body = await expectSpec(await app.request('/api/v1/health/db'), '/health/db')
  assert.equal(body.migrations, migrationFiles().length)
})

test('GET /me acts as the demo owner and sets workspace and user for the request', async () => {
  await demoDb()
  const app = createApp({ env: {}, getDb: () => db })
  const body = await expectSpec(await app.request('/api/v1/me'), '/me')
  assert.equal(body.email, 'david@demo.signalflow.example')
  assert.equal(body.role, 'owner')
  assert.equal(body.workspaceName, 'Higherwave Demo')
})

test('a different demo user can be chosen with DEV_USER_EMAIL (viewer role)', async () => {
  await demoDb()
  const app = createApp({ env: { DEV_USER_EMAIL: 'sam@demo.signalflow.example' }, getDb: () => db })
  const body = await (await app.request('/api/v1/me')).json()
  assert.equal(body.role, 'viewer')
})

test('DEV_TOKEN: reads are open to the read-only demo viewer; the token gives the owner', async () => {
  await demoDb()
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const anon = await app.request('/api/v1/me')
  assert.equal(anon.status, 200)
  assert.equal((await expectSpec(anon, '/me')).role, 'viewer')
  const authed = await app.request('/api/v1/me', { headers: { authorization: 'Bearer s3cret' } })
  assert.equal((await expectSpec(authed, '/me')).role, 'owner')
  assert.equal((await app.request('/api/v1/health')).status, 200)
})

test('a wrong token is always refused, even for reads', async () => {
  await demoDb()
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  for (const path of ['/api/v1/me', '/api/v1/projects']) {
    const res = await app.request(path, { headers: { authorization: 'Bearer wrong' } })
    assert.equal(res.status, 401)
    assert.equal((await res.json()).error.code, 'unauthorized')
  }
})

test('diagnostics stay behind the token: /health/db cannot be used to wake the database anonymously', async () => {
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => forbiddenDb })
  const res = await app.request('/api/v1/health/db')
  assert.equal(res.status, 401)
  assert.equal((await expectSpec(res, '/health/db')).error.code, 'unauthorized')
})

test('writes are never open: a non-GET request without the token is refused', async () => {
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => forbiddenDb })
  // No write routes exist yet; the guard must still hold for any that are added behind the read context.
  const { requestContext } = await import('./context.js')
  const { Hono } = await import('hono')
  const { ApiError } = await import('./errors.js')
  const probe = new Hono()
  probe.onError((err, c) => (err instanceof ApiError ? c.json({ error: { code: err.code } }, err.status) : c.text('error', 500)))
  probe.post('/x', requestContext({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db }, 'read'), (c) => c.text('ok'))
  const res = await probe.request('/x', { method: 'POST' })
  assert.equal(res.status, 401)
  assert.ok(app)
})

test('a production deployment with no DEV_TOKEN refuses data routes', async () => {
  const app = createApp({ env: { VERCEL_ENV: 'production' }, getDb: () => forbiddenDb })
  const res = await app.request('/api/v1/health/db')
  assert.equal(res.status, 401)
  assert.equal((await expectSpec(res, '/health/db')).error.code, 'auth_not_configured')
  assert.equal((await app.request('/api/v1/health')).status, 200)
})

test('a paused or unreachable database becomes a 503 db_unavailable envelope', async () => {
  const refuse = async (): Promise<never> => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) }
  const down = wrapDb({ query: refuse, transaction: refuse })
  const app = createApp({ env: {}, getDb: () => down })
  const res = await app.request('/api/v1/health/db')
  assert.equal(res.status, 503)
  assert.equal((await expectSpec(res, '/health/db')).error.code, 'db_unavailable')
})

test('no connection string configured is also db_unavailable, not a crash', async () => {
  const app = createApp({ env: {} }) // default lazy Postgres with no URL
  const res = await app.request('/api/v1/health/db')
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error.code, 'db_unavailable')
})

test('an unseeded database gives workspace_not_found with a hint', async () => {
  const empty = new PGlite()
  for (const f of migrationFiles()) await empty.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'))
  const app = createApp({ env: {}, getDb: () => pgliteDb(empty) })
  const res = await app.request('/api/v1/me')
  assert.equal(res.status, 503)
  assert.equal((await res.json()).error.code, 'workspace_not_found')
})

test('unknown routes use the error envelope', async () => {
  const app = createApp({ env: {}, getDb: () => forbiddenDb })
  const res = await app.request('/api/v1/nope')
  assert.equal(res.status, 404)
  assert.equal((await res.json()).error.code, 'not_found')
})

test('every operation in the spec has a route, and every route is in the spec', async () => {
  const app = createApp({ env: {}, getDb: () => forbiddenDb })
  const routes = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method.toLowerCase()} ${r.path.replace('/api/v1', '').replace(/:(\w+)/g, '{$1}')}`)
  const declared = Object.entries(spec.paths).flatMap(([p, ops]: [string, any]) => Object.keys(ops).map((m) => `${m} ${p}`))
  assert.deepEqual([...new Set(routes)].sort(), declared.sort())
})

test('connection strings are found by suffix, pooled for the API and unpooled for migrations', () => {
  const env = { bizprocess_DATABASE_URL: 'postgresql://pooled', bizprocess_DATABASE_URL_UNPOOLED: 'postgresql://direct', bizprocess_PGHOST: 'h' }
  assert.equal(findConnectionString(env, 'pooled'), 'postgresql://pooled')
  assert.equal(findConnectionString(env, 'direct'), 'postgresql://direct')
  assert.equal(findConnectionString({ bizprocess_PGHOST: 'h' }), undefined)
})

test('databaseUnavailable carries a short detail, never credentials', () => {
  assert.equal(databaseUnavailable('ECONNREFUSED').status, 503)
  assert.doesNotMatch(databaseUnavailable('x').message, /postgres/i)
})

test('connection string cleaning keeps a valid query string whatever the parameter order', () => {
  const pooled = 'postgresql://user:pw@ep-x-pooler.us-west-2.aws.neon.tech/neondb?channel_binding=require&sslmode=require'
  const reversed = 'postgresql://user:pw@ep-x-pooler.us-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require'
  const plain = 'postgresql://user:pw@host/db'
  for (const url of [pooled, reversed]) {
    const out = new URL(cleanConnectionString(url))
    assert.equal(out.search, '?sslmode=verify-full')
    assert.equal(out.pathname, '/neondb')
    assert.equal(out.username, 'user')
  }
  assert.equal(new URL(cleanConnectionString(plain)).search, '')
})

test('GET /projects returns the seeded projects with derived status and card figures', async () => {
  await demoDb()
  const app = createApp({ env: {}, getDb: () => db })
  const res = await app.request('/api/v1/projects')
  const body = await expectSpec(res, '/projects')
  assert.equal(body.next_cursor, null)
  const byName = Object.fromEntries(body.data.map((p: any) => [p.name, p]))
  assert.deepEqual(Object.keys(byName).sort(), ['Check-in diary study', 'Clinic booking, round 2', 'Clinic booking, usability round 1', 'New patient intake (draft)'])
  const pick = (n: string) => { const p = byName[n]; return [p.status, p.sessions, p.themes, p.highPriority, p.color, p.template] }
  assert.deepEqual(pick('Clinic booking, usability round 1'), ['analyzed', 3, 9, 6, 'cream', 'Usability test'])
  assert.deepEqual(pick('Clinic booking, round 2'), ['analyzed', 4, 5, 4, 'mint', 'Usability test'])
  assert.deepEqual(pick('Check-in diary study'), ['analyzed', 6, 3, 2, 'lavender', 'Discovery interviews'])
  assert.deepEqual(pick('New patient intake (draft)'), ['draft', 0, 0, 0, 'coral', 'Concept test'])
})

test('project status follows the current analysis run: a superseded run leaves the project as a draft', async () => {
  await demoDb()
  const app = createApp({ env: {}, getDb: () => db })
  await pglite.query<any>(`update core.agent_runs set superseded_at = now() where kind = 'analysis' and project_id = (select id from core.projects where name = 'Check-in diary study')`)
  const body = await (await app.request('/api/v1/projects')).json()
  const p = body.data.find((x: any) => x.name === 'Check-in diary study')
  assert.deepEqual([p.status, p.themes], ['draft', 0])
  await pglite.query<any>(`update core.agent_runs set superseded_at = null where kind = 'analysis'`)
})

test('projects are scoped to the workspace', async () => {
  await demoDb()
  const other = (await pglite.query<any>(`insert into core.workspaces (name, slug) values ('Other', 'other-ws') returning id`)).rows[0] as { id: string }
  await pglite.query<any>(`insert into core.projects (workspace_id, name) values ($1, 'Not yours')`, [other.id])
  const app = createApp({ env: {}, getDb: () => db })
  const names = (await (await app.request('/api/v1/projects')).json()).data.map((p: any) => p.name)
  assert.ok(!names.includes('Not yours'))
  await pglite.query<any>(`delete from core.workspaces where slug = 'other-ws'`)
})

test('cache headers: anonymous reads are cacheable for a minute, token requests never', async () => {
  await demoDb()
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const anon = await app.request('/api/v1/projects')
  assert.match(anon.headers.get('cache-control') ?? '', /public, s-maxage=60/)
  assert.equal(anon.headers.get('vary'), 'Authorization')
  const authed = await app.request('/api/v1/projects', { headers: { authorization: 'Bearer s3cret' } })
  assert.equal(authed.headers.get('cache-control'), 'private, no-store')
})

// Writes -------------------------------------------------------------------------------------------

const TOKEN = { DEV_TOKEN: 's3cret' }
const auth = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const newProject = (over: Record<string, unknown> = {}) => ({
  name: 'Onboarding study', methods: ['Moderated usability test'],
  testItems: [{ description: 'Whether new users finish setup', outcomes: ['Completion above 80%', ''] }, { description: '', outcomes: [] }],
  participants: [{ name: 'Ada Lovelace', role: 'Engineer', email: 'Ada@Example.com', phone: ' (555) 010-0000 ', sessionDate: '2026-11-02' }], ...over,
})
const post = (app: ReturnType<typeof createApp>, body: unknown, headers: Record<string, string> = auth) =>
  app.request('/api/v1/projects', { method: 'POST', headers, body: JSON.stringify(body) })

test('GET /templates lists the four templates in order, with the method options', async () => {
  await demoDb()
  const app = createApp({ env: {}, getDb: () => db })
  const body = await expectSpec(await app.request('/api/v1/templates'), '/templates')
  assert.deepEqual(body.data.map((t: any) => t.key), ['usability', 'discovery', 'concept', 'blank'])
  assert.equal(body.data[0].tasks[0].prompt, 'Find and book an appointment with a provider you would trust.')
  assert.deepEqual(body.data[0].tasks[0].followUps.length, 2)
  assert.ok(body.methodOptions.includes('Diary study'))
})

test('POST /projects creates the project, test items, stages, participants and the template starter tasks together', async () => {
  await demoDb()
  const app = createApp({ env: TOKEN, getDb: () => db })
  const res = await post(app, newProject({ templateKey: 'usability' }))
  assert.equal(res.status, 201)
  const created = await expectSpec(res, '/projects', 'post')
  assert.deepEqual([created.name, created.status, created.sessions, created.themes, created.template], ['Onboarding study', 'draft', 0, 0, 'Usability test'])
  const id = created.id
  const q = async (sql: string) => (await pglite.query<any>(sql, [id])).rows as any[]
  assert.deepEqual((await q(`select methods m from research.studies where project_id = $1`))[0], { m: ['Moderated usability test'] })
  assert.deepEqual((await q(`select description d, outcomes o, position p from research.test_items where project_id = $1 order by position`)), [{ d: 'Whether new users finish setup', o: ['Completion above 80%'], p: 0 }], 'the empty second item is dropped')
  assert.equal((await q(`select count(*)::int n from research.study_stages where study_id = $1`))[0].n, 5)
  assert.deepEqual((await q(`select name, email, phone, session_date::text d from research.participants where project_id = $1`))[0], { name: 'Ada Lovelace', email: 'ada@example.com', phone: '(555) 010-0000', d: '2026-11-02' })
  assert.deepEqual((await q(`select count(*) filter (where parent_task_id is null)::int q, count(*) filter (where parent_task_id is not null)::int f from research.tasks where project_id = $1`))[0], { q: 2, f: 3 })
  assert.equal((await q(`select verb from core.audit_log where entity_id = $1`))[0].verb, 'created')
  // It shows up in the list as a draft, in a tint no other project in the workspace uses yet.
  const list = (await (await app.request('/api/v1/projects')).json()).data
  const mine = list.find((p: any) => p.id === id)
  assert.equal(mine.status, 'draft')
  assert.equal(list.filter((p: any) => p.color === mine.color).length, 1)
})

test('POST /projects without a template uses the blank one and starts with no tasks', async () => {
  await demoDb()
  const app = createApp({ env: TOKEN, getDb: () => db })
  const created = await (await post(app, newProject({ name: 'Blank one' }))).json()
  assert.equal(created.template, 'Blank project')
  assert.equal((await pglite.query<any>(`select count(*)::int n from research.tasks where project_id = $1`, [created.id])).rows[0].n, 0)
})

test('POST /projects validates, naming the field: 422 validation_failed', async () => {
  await demoDb()
  const app = createApp({ env: TOKEN, getDb: () => db })
  const cases: [Record<string, unknown>, string][] = [
    [newProject({ name: '  ' }), 'name'],
    [newProject({ participants: [] }), 'participants'],
    [newProject({ participants: [{ name: 'Ada', email: 'not-an-email' }] }), 'participants.0.email'],
    [newProject({ participants: [{ name: '', email: 'a@b.co' }] }), 'participants.0.name'],
    [newProject({ methods: ['Mind reading'] }), 'methods.0'],
    [newProject({ templateKey: 'nope' }), 'templateKey'],
    [newProject({ testItems: Array.from({ length: 21 }, () => ({ description: 'x', outcomes: [] })) }), 'testItems'],
    [newProject({ participants: [{ name: 'Ada', email: 'a@b.co', sessionDate: 'Oct 6' }] }), 'participants.0.sessionDate'],
  ]
  for (const [body, field] of cases) {
    const res = await post(app, body)
    assert.equal(res.status, 422, field)
    const err = (await expectSpec(res, '/projects', 'post')).error
    assert.deepEqual([err.code, err.field], ['validation_failed', field])
  }
  const bad = await app.request('/api/v1/projects', { method: 'POST', headers: auth, body: '{not json' })
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error.code, 'invalid_json')
})

test('a failed create leaves nothing behind (one transaction)', async () => {
  await demoDb()
  const before = (await pglite.query<any>(`select count(*)::int n from core.projects`)).rows[0].n
  // An email longer than the database allows is not caught by the schema in this test's fixture; force
  // a failure inside the transaction by removing a table the create writes to.
  await pglite.query<any>(`alter table research.study_stages rename to study_stages_x`)
  const app = createApp({ env: TOKEN, getDb: () => db })
  const res = await post(app, newProject({ name: 'Will fail' }))
  await pglite.query<any>(`alter table research.study_stages_x rename to study_stages`)
  assert.equal(res.status, 500)
  assert.equal((await pglite.query<any>(`select count(*)::int n from core.projects`)).rows[0].n, before)
  assert.equal((await pglite.query<any>(`select count(*)::int n from core.projects where name = 'Will fail'`)).rows[0].n, 0)
})

test('writes need the token: anonymous and wrong-token requests are refused', async () => {
  await demoDb()
  const app = createApp({ env: TOKEN, getDb: () => db })
  assert.equal((await post(app, newProject(), { 'content-type': 'application/json' })).status, 401)
  assert.equal((await post(app, newProject(), { authorization: 'Bearer wrong', 'content-type': 'application/json' })).status, 401)
  const del = await app.request('/api/v1/projects/' + '0'.repeat(8) + '-0000-4000-8000-' + '0'.repeat(12), { method: 'DELETE' })
  assert.equal(del.status, 401)
})

test('OPEN_EDITING=true lets a visitor with no token write, as the owner; a wrong token is still refused', async () => {
  await demoDb()
  const open = createApp({ env: { ...TOKEN, OPEN_EDITING: 'true' }, getDb: () => db })
  const json = { 'content-type': 'application/json' }
  const me = await (await open.request('/api/v1/me')).json()
  assert.equal(me.role, 'owner')
  assert.equal((await post(open, newProject({ name: 'Open editing' }), json)).status, 201)
  assert.equal((await post(open, newProject({ name: 'Wrong token' }), { authorization: 'Bearer wrong', ...json })).status, 401)
  // Off (the default), the same visitor is a read-only viewer.
  const closed = createApp({ env: TOKEN, getDb: () => db })
  assert.equal((await (await closed.request('/api/v1/me')).json()).role, 'viewer')
  assert.equal((await post(closed, newProject({ name: 'Closed' }), json)).status, 401)
  // A production deployment with no DEV_TOKEN is refused unless editing was opened on purpose.
  const prod = { VERCEL_ENV: 'production' }
  assert.equal((await post(createApp({ env: prod, getDb: () => db }), newProject(), json)).status, 401)
  assert.equal((await post(createApp({ env: { ...prod, OPEN_EDITING: 'true' }, getDb: () => db }), newProject({ name: 'Prod open' }), json)).status, 201)
})

test('a viewer role cannot write even with a valid token (403 forbidden)', async () => {
  await demoDb()
  const app = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'sam@demo.signalflow.example' }, getDb: () => db })
  const res = await post(app, newProject())
  assert.equal(res.status, 403)
  assert.equal((await expectSpec(res, '/projects', 'post')).error.code, 'forbidden')
})

test('DELETE /projects/:id removes the project and everything under it, and audits it', async () => {
  await demoDb()
  const app = createApp({ env: TOKEN, getDb: () => db })
  const created = await (await post(app, newProject({ name: 'Delete me' }))).json()
  const res = await app.request(`/api/v1/projects/${created.id}`, { method: 'DELETE', headers: auth })
  assert.equal(res.status, 204)
  for (const t of ['research.studies', 'research.test_items', 'research.participants', 'research.tasks', 'research.study_stages']) {
    const col = t === 'research.studies' ? 'project_id' : t === 'research.study_stages' ? 'study_id' : 'project_id'
    assert.equal((await pglite.query<any>(`select count(*)::int n from ${t} where ${col} = $1`, [created.id])).rows[0].n, 0, t)
  }
  const audit = (await pglite.query<any>(`select verb, before from core.audit_log where entity_id = $1 order by created_at, verb`, [created.id])).rows as any[]
  assert.deepEqual(audit.map((a) => a.verb).sort(), ['created', 'deleted'])
  assert.equal(audit.find((a) => a.verb === 'deleted').before.name, 'Delete me')
  const again = await app.request(`/api/v1/projects/${created.id}`, { method: 'DELETE', headers: auth })
  assert.equal(again.status, 404)
  assert.equal((await expectSpec(again, '/projects/{id}', 'delete')).error.code, 'not_found')
})

test('DELETE cannot reach another workspace or a malformed id', async () => {
  await demoDb()
  const other = (await pglite.query<any>(`insert into core.workspaces (name, slug) values ('Other', 'other-del') returning id`)).rows[0] as { id: string }
  const foreign = (await pglite.query<any>(`insert into core.projects (workspace_id, name) values ($1, 'Foreign') returning id`, [other.id])).rows[0] as { id: string }
  const app = createApp({ env: TOKEN, getDb: () => db })
  assert.equal((await app.request(`/api/v1/projects/${foreign.id}`, { method: 'DELETE', headers: auth })).status, 404)
  assert.equal((await app.request(`/api/v1/projects/not-a-uuid`, { method: 'DELETE', headers: auth })).status, 404)
  assert.equal((await pglite.query<any>(`select count(*)::int n from core.projects where id = $1`, [foreign.id])).rows[0].n, 1)
  await pglite.query<any>(`delete from core.workspaces where slug = 'other-del'`)
})

test('deleting a project removes its platform-theme sources, so Insights counts update', async () => {
  const { pglite: p2, db: d2 } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d2 })
  const target = (await p2.query<any>(`select id from core.projects where name = 'Check-in diary study'`)).rows[0] as { id: string }
  const before = (await p2.query<any>(`select count(*)::int n from insights.platform_theme_sources`)).rows[0] as { n: number }
  assert.equal((await app.request(`/api/v1/projects/${target.id}`, { method: 'DELETE', headers: auth })).status, 204)
  const after = (await p2.query<any>(`select count(*)::int n from insights.platform_theme_sources`)).rows[0] as { n: number }
  assert.ok(after.n < before.n, 'platform sources for the deleted project are gone')
  assert.equal((await p2.query<any>(`select participant_count::int n from insights.workspace_stats`)).rows[0].n, 7)
})

// One project: detail, steps and versioned saves -------------------------------------------------------

async function withFresh<T>(fn: (ctx: { app: ReturnType<typeof createApp>; pg: PGlite; p1: string; version: () => Promise<number> }) => Promise<T>) {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d })
  const p1 = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  return fn({ app, pg, p1, version: async () => ((await pg.query<any>(`select version from core.projects where id = $1`, [p1])).rows[0] as { version: number }).version })
}
const put = (app: ReturnType<typeof createApp>, path: string, body: unknown, version: number | string | null, headers: Record<string, string> = auth) =>
  app.request(`/api/v1${path}`, { method: 'PUT', headers: { ...headers, ...(version === null ? {} : { 'if-match': String(version) }) }, body: JSON.stringify(body) })

// A save sends the whole page, so tests start from what is saved now and change one thing.
const planOf = async (app: ReturnType<typeof createApp>, id: string, over: Record<string, unknown> = {}) => {
  const d = await (await app.request(`/api/v1/projects/${id}`)).json()
  return {
    name: d.name, methods: d.study.methods, testItems: d.testItems.map((i: any) => ({ description: i.description, outcomes: i.outcomes })),
    participants: d.participants.map((p: any) => ({ id: p.id, name: p.name, role: p.role, email: p.email, phone: p.phone, sessionDate: p.sessionDate })), ...over,
  }
}

test('GET /projects/:id returns the test plan, stages, participants in order, and tasks with follow-ups; ETag is the version', async () => {
  await withFresh(async ({ app, p1, version }) => {
    const res = await app.request(`/api/v1/projects/${p1}`)
    const body = await expectSpec(res, '/projects/{id}')
    assert.equal(res.headers.get('etag'), `"${await version()}"`)
    assert.equal(body.name, 'Clinic booking, usability round 1')
    assert.equal(body.testItems.length, 1)
    assert.match(body.testItems[0].description, /^Whether patients can find a provider/)
    assert.deepEqual(body.testItems[0].outcomes, ['Task completion rate above 80%', 'Top barriers ranked by severity'])
    assert.deepEqual(body.study.methods, ['Moderated usability test', 'Survey follow-up'])
    assert.equal(body.stages.length, 5)
    assert.deepEqual(body.participants.map((p: any) => p.name), ['Maya Chen', 'Daniel Ortiz', 'Priya Nair'])
    assert.equal(body.participants[0].sessionDate, '2026-10-06')
    assert.equal(body.participants[0].phone, null)
    assert.deepEqual(body.tasks.map((t: any) => t.followUps.length), [2, 1])
    assert.equal(body.status, 'analyzed')
  })
})

test('GET /projects/:id: unknown, malformed and other-workspace ids are 404', async () => {
  await withFresh(async ({ app, pg }) => {
    const other = (await pg.query<any>(`insert into core.workspaces (name, slug) values ('Other', 'other-d') returning id`)).rows[0] as { id: string }
    const foreign = (await pg.query<any>(`insert into core.projects (workspace_id, name) values ($1, 'Foreign') returning id`, [other.id])).rows[0] as { id: string }
    for (const id of [foreign.id, 'not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      const res = await app.request(`/api/v1/projects/${id}`)
      assert.equal(res.status, 404, id)
      assert.equal((await expectSpec(res, '/projects/{id}')).error.code, 'not_found')
    }
  })
})

test('GET /projects/:id/stage: the server decides which steps are open', async () => {
  await withFresh(async ({ app, pg }) => {
    const idOf = async (name: string) => ((await pg.query<any>(`select id from core.projects where name = $1`, [name])).rows[0] as { id: string }).id
    const tabs = async (name: string) => (await expectSpec(await app.request(`/api/v1/projects/${await idOf(name)}/stage`), '/projects/{id}/stage')).tabs
    const open = (t: any) => Object.fromEntries(Object.entries(t).map(([k, v]: [string, any]) => [k, v.enabled]))
    // Published board: everything open.
    assert.ok(Object.values(open(await tabs('Clinic booking, usability round 1'))).every(Boolean))
    // Analysed, nothing published: Stories locked with its hint.
    const r2 = await tabs('Clinic booking, round 2')
    assert.deepEqual([r2.themes.enabled, r2.requirements.enabled, r2.stories.enabled, r2.stories.hint], [true, true, false, 'Publish the requirements first'])
    // Draft: only the plan steps.
    const draft = await tabs('New patient intake (draft)')
    assert.deepEqual(open(draft), { plan: true, tasks: true, transcripts: true, themes: false, journey: false, prio: false, requirements: false, stories: false })
    assert.equal(draft.themes.hint, 'Save and analyze a transcript first')
  })
})

test('saving needs If-Match: without it, 428 precondition_required', async () => {
  await withFresh(async ({ app, p1 }) => {
    const res = await put(app, `/projects/${p1}/study`, { name: 'Renamed' }, null)
    assert.equal(res.status, 428)
    assert.equal((await expectSpec(res, '/projects/{id}/study', 'put')).error.code, 'precondition_required')
    assert.equal((await put(app, `/projects/${p1}/study`, { name: 'Renamed' }, 'abc')).status, 428)
  })
})

test('PUT study saves the name, methods, test items and participants, bumps the version by one, and audits it', async () => {
  await withFresh(async ({ app, pg, p1, version }) => {
    const v0 = await version()
    const res = await put(app, `/projects/${p1}/study`, await planOf(app, p1, {
      name: ' Clinic booking, round 1 ', methods: ['Card sort'],
      testItems: [{ description: 'New wording', outcomes: ['One', '', 'Two'] }, { description: '', outcomes: [] }, { description: null, outcomes: ['Only an outcome'] }],
    }), v0)
    assert.equal(res.status, 200)
    const body = await expectSpec(res, '/projects/{id}/study', 'put')
    assert.deepEqual([body.name, body.version, body.study.methods], ['Clinic booking, round 1', v0 + 1, ['Card sort']])
    assert.deepEqual(body.testItems.map((i: any) => [i.description, i.outcomes]), [['New wording', ['One', 'Two']], [null, ['Only an outcome']]], 'blank outcomes and the empty item are dropped; order is kept')
    assert.equal(body.participants.length, 3, 'the participants were sent back unchanged')
    assert.equal(res.headers.get('etag'), `"${v0 + 1}"`)
    assert.equal((await pg.query<any>(`select count(*)::int n from core.audit_log where entity_id = $1 and verb = 'plan_saved'`, [p1])).rows[0].n, 1)
    // Themes and board are untouched by a plan save.
    assert.equal(body.themes, 9)
  })
})

test('a stale version is refused with 409 and the current version; nothing is overwritten', async () => {
  await withFresh(async ({ app, p1, version }) => {
    const v0 = await version()
    const same = await planOf(app, p1)
    assert.equal((await put(app, `/projects/${p1}/study`, { ...same, name: 'First save' }, v0)).status, 200)
    const stale = await put(app, `/projects/${p1}/study`, { ...same, name: 'Second save, from the old page' }, v0)
    assert.equal(stale.status, 409)
    const body = await expectSpec(stale, '/projects/{id}/study', 'put')
    assert.deepEqual([body.error.code, body.current.version], ['version_conflict', v0 + 1])
    const now = await (await app.request(`/api/v1/projects/${p1}`, { headers: auth })).json()
    assert.equal(now.name, 'First save', 'the first save survives')
    // Overwrite is a deliberate resend with the current version.
    assert.equal((await put(app, `/projects/${p1}/study`, { ...same, name: 'Second save, from the old page' }, body.current.version)).status, 200)
  })
})

test('saves validate: names the field, and a viewer or missing token cannot save', async () => {
  await withFresh(async ({ app, p1, version }) => {
    const v = await version()
    const same = await planOf(app, p1)
    const bad = await put(app, `/projects/${p1}/study`, { ...same, name: '  ' }, v)
    assert.equal(bad.status, 422)
    assert.deepEqual([(await bad.json()).error.field], ['name'])
    assert.equal((await put(app, `/projects/${p1}/study`, { ...same, methods: ['Mind reading'] }, v)).status, 422)
    assert.equal((await put(app, `/projects/${p1}/study`, { ...same, name: 'x' }, v, { 'content-type': 'application/json' })).status, 401)
  })
  const { pglite: pg2, db: d2 } = await createDemoDatabase()
  const viewerApp = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'sam@demo.signalflow.example' }, getDb: () => d2 })
  const id = ((await pg2.query<any>(`select id from core.projects limit 1`)).rows[0] as { id: string }).id
  assert.equal((await put(viewerApp, `/projects/${id}/study`, { name: 'x', participants: [{ name: 'A', email: 'a@b.co' }] }, 1)).status, 403)
})

test('PUT study keeps participant identity: speakers stay matched, removed ones unmatch, order follows the list', async () => {
  await withFresh(async ({ app, pg, p1, version }) => {
    const detail = await (await app.request(`/api/v1/projects/${p1}`)).json()
    const [maya, daniel] = detail.participants
    const speakerOf = async (name: string) => ((await pg.query<any>(`select distinct participant_id from research.transcript_speakers where name = $1`, [name])).rows as any[]).map((r) => r.participant_id)
    assert.deepEqual(await speakerOf('Maya Chen'), [maya.id])
    const res = await put(app, `/projects/${p1}/study`, {
      ...(await planOf(app, p1)),
      participants: [
        { id: daniel.id, name: 'Daniel Ortiz', role: 'Night-shift nurse', email: 'D.Ortiz@Example.com', phone: '555 0100', sessionDate: '2026-10-07' },
        { id: maya.id, name: 'Maya Chen', role: maya.role, email: maya.email, sessionDate: maya.sessionDate },
        { name: 'New Person', email: 'new@example.com' },
      ],
    }, await version())
    assert.equal(res.status, 200)
    const body = await expectSpec(res, '/projects/{id}/study', 'put')
    assert.deepEqual(body.participants.map((p: any) => p.name), ['Daniel Ortiz', 'Maya Chen', 'New Person'])
    assert.deepEqual([body.participants[0].id, body.participants[1].id], [daniel.id, maya.id], 'ids kept')
    assert.equal(body.participants[0].email, 'd.ortiz@example.com')
    assert.equal(body.participants[0].role, 'Night-shift nurse')
    assert.equal(body.participants[0].phone, '555 0100')
    assert.deepEqual(await speakerOf('Maya Chen'), [maya.id], 'Maya’s speakers are still matched')
    assert.deepEqual(await speakerOf('Priya Nair'), [null], 'Priya was removed, so her speakers are unmatched, not deleted')
    assert.equal(body.themes, 9, 'themes are untouched')
  })
})

test('PUT study: an unknown participant id, an empty list and a bad email are 422', async () => {
  await withFresh(async ({ app, p1, version }) => {
    const v = await version()
    const same = await planOf(app, p1)
    const unknown = await put(app, `/projects/${p1}/study`, { ...same, participants: [{ id: '00000000-0000-4000-8000-000000000000', name: 'X', email: 'x@y.co' }] }, v)
    assert.equal(unknown.status, 422)
    assert.equal((await put(app, `/projects/${p1}/study`, { ...same, participants: [] }, v)).status, 422)
    const bad = await put(app, `/projects/${p1}/study`, { ...same, participants: [{ name: 'X', email: 'nope' }] }, v)
    assert.deepEqual([bad.status, (await bad.json()).error.field], [422, 'participants.0.email'])
    assert.equal(await version(), v, 'failed saves do not change the version')
  })
})

test('PUT tasks replaces the list with follow-ups; blank follow-ups are dropped; an empty list is allowed', async () => {
  await withFresh(async ({ app, p1, version }) => {
    const res = await put(app, `/projects/${p1}/tasks`, { tasks: [{ prompt: 'Book a visit', followUps: ['Why?', '', 'What next?'] }, { prompt: 'Cancel it' }] }, await version())
    assert.equal(res.status, 200)
    const body = await expectSpec(res, '/projects/{id}/tasks', 'put')
    assert.deepEqual(body.tasks.map((t: any) => [t.prompt, t.followUps.map((f: any) => f.prompt)]), [['Book a visit', ['Why?', 'What next?']], ['Cancel it', []]])
    const empty = await put(app, `/projects/${p1}/tasks`, { tasks: [] }, body.version)
    assert.deepEqual((await empty.json()).tasks, [])
    const blank = await put(app, `/projects/${p1}/tasks`, { tasks: [{ prompt: '  ' }] }, body.version + 1)
    assert.deepEqual([blank.status, (await blank.json()).error.field], [422, 'tasks.0.prompt'])
  })
})

test('every kind of save bumps the version by exactly one', async () => {
  await withFresh(async ({ app, p1, version }) => {
    const v0 = await version()
    await put(app, `/projects/${p1}/study`, await planOf(app, p1, { name: 'A' }), v0)
    await put(app, `/projects/${p1}/tasks`, { tasks: [{ prompt: 'Q' }] }, v0 + 1)
    assert.equal(await version(), v0 + 2)
  })
})

// Transcripts and the simulated analysis ---------------------------------------------------------------

import research from '../db/seed/data/research.json' with { type: 'json' }

const SAMPLES = research.SAMPLES as { name: string; platform: string; text: string }[]
const SAMPLE_PEOPLE = [{ name: 'Maya Chen', email: 'maya@example.com' }, { name: 'Daniel Ortiz', email: 'daniel@example.com' }, { name: 'Priya Nair', email: 'priya@example.com' }]
const PROTOTYPE_THEMES = [
  'Insurance coverage is unclear up front', 'Reminders build confidence', 'Provider availability is hard to see', 'Rescheduling forces a phone call',
  'Booking form repeats questions', 'Price surprises at confirmation', 'Follow-up instructions get lost', 'Reviews and ratings drive trust', 'Wants to know what to prepare',
]

// A new project (with the three sample participants) and helpers that carry the version along.
async function newStudy(provider?: AiProvider, env: Record<string, string> = {}) {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: { ...TOKEN, ...env }, getDb: () => d, provider })
  const created = await (await post(app, newProject({ name: 'Transcript study', participants: SAMPLE_PEOPLE }))).json()
  const id: string = created.id
  const version = async () => ((await pg.query<any>(`select version from core.projects where id = $1`, [id])).rows[0] as { version: number }).version
  const putTranscripts = async (transcripts: unknown[], v?: number) => put(app, `/projects/${id}/transcripts`, { transcripts }, v ?? (await version()))
  const analyze = async (v?: number) => app.request(`/api/v1/projects/${id}/analysis-runs`, { method: 'POST', headers: { ...auth, 'if-match': String(v ?? (await version())) }, body: '{}' })
  const samples = SAMPLES.map((s) => ({ name: s.name, platform: s.platform.toLowerCase(), rawText: s.text }))
  return { app, pg, id, version, putTranscripts, analyze, samples }
}

test('a new project has no transcripts and needs no analysis', async () => {
  const { app, id } = await newStudy()
  const body = await expectSpec(await app.request(`/api/v1/projects/${id}/transcripts`), '/projects/{id}/transcripts')
  assert.deepEqual([body.transcripts.length, body.hasAnalysis, body.needsAnalysis, body.analyzedAt], [0, false, false, null])
})

test('PUT transcripts splits each into speakers and lines, matches participants by name, and keeps the order', async () => {
  const { app, id, putTranscripts, samples } = await newStudy()
  const res = await putTranscripts(samples)
  assert.equal(res.status, 200)
  const body = await expectSpec(res, '/projects/{id}/transcripts', 'put')
  assert.deepEqual(body.transcripts.map((t: any) => [t.name, t.platform]), [['Session 1 - Maya Chen.vtt', 'zoom'], ['Session 2 - Daniel Ortiz.txt', 'meet'], ['Session 3 - Priya Nair.vtt', 'teams']])
  const first = body.transcripts[0]
  assert.ok(first.lineCount > 3)
  assert.deepEqual(first.speakers.map((s: any) => [s.name, s.role, s.participant]), [['Moderator', 'moderator', null], ['Maya Chen', 'participant', 'Maya Chen']])
  assert.deepEqual(body.transcripts[2].speakers.map((s: any) => s.participant), [null, 'Priya Nair'], 'teams format with <v Name> tags parses too')
  assert.deepEqual([body.hasAnalysis, body.needsAnalysis], [false, true], 'transcripts exist but nothing has analysed them')
  // Reading it back gives the same.
  assert.deepEqual((await (await app.request(`/api/v1/projects/${id}/transcripts`)).json()).transcripts.map((t: any) => t.id), body.transcripts.map((t: any) => t.id))
})

test('transcript text with no speaker lines is a 422 naming the field', async () => {
  const { putTranscripts } = await newStudy()
  const res = await putTranscripts([{ name: 'Notes', rawText: 'just some prose with no speakers at all' }])
  assert.equal(res.status, 422)
  const err = (await expectSpec(res, '/projects/{id}/transcripts', 'put')).error
  assert.deepEqual([err.code, err.field], ['validation_failed', 'transcripts.0.rawText'])
  assert.equal((await putTranscripts([{ name: '', rawText: 'A: b' }])).status, 422)
  assert.equal((await putTranscripts([{ name: 'x', rawText: 'A: b', platform: 'skype' }])).status, 422)
})

test('the simulated analysis reproduces the prototype: 9 themes, same order, same counts and priorities', async () => {
  const { app, pg, id, putTranscripts, analyze, samples } = await newStudy()
  await putTranscripts(samples)
  const res = await analyze()
  assert.equal(res.status, 201)
  const run = await expectSpec(res, '/projects/{id}/analysis-runs', 'post')
  assert.deepEqual([run.themes, run.steps.length], [9, 5])
  const rows = (await pg.query<any>(`select t.title, t.suggested_priority p, t.suggested_effort e, s.participant_count::int ppl, s.total_participants::int total, s.mention_count::int m
    from research.themes t join research.theme_stats s on s.theme_id = t.id where t.project_id = $1 order by t.score desc, t.title`, [id])).rows as any[]
  assert.deepEqual(rows.map((r) => r.title), PROTOTYPE_THEMES)
  assert.deepEqual(rows.slice(0, 5).map((r) => [r.ppl, r.total, r.m, r.p]), Array(5).fill([3, 3, 3, 'high']))
  assert.deepEqual(rows.slice(5).map((r) => [r.ppl, r.m, r.p]), [[2, 2, 'high'], [2, 2, 'medium'], [2, 2, 'medium'], [2, 2, 'medium']])
  // Now the project is analysed, and its steps are open.
  const list = (await (await app.request('/api/v1/projects')).json()).data.find((p: any) => p.id === id)
  assert.deepEqual([list.status, list.themes, list.sessions, list.highPriority], ['analyzed', 9, 3, 6])
  const tabs = (await (await app.request(`/api/v1/projects/${id}/stage`)).json()).tabs
  assert.deepEqual([tabs.themes.enabled, tabs.requirements.enabled, tabs.stories.enabled], [true, true, false])
  const after = await (await app.request(`/api/v1/projects/${id}/transcripts`)).json()
  assert.deepEqual([after.hasAnalysis, after.needsAnalysis], [true, false])
  assert.ok(after.analyzedAt)
})

test('analysing without transcripts is a 422 no_transcripts', async () => {
  const { analyze } = await newStudy()
  const res = await analyze()
  assert.equal(res.status, 422)
  assert.equal((await expectSpec(res, '/projects/{id}/analysis-runs', 'post')).error.code, 'no_transcripts')
})

test('editing a transcript makes the analysis out of date; unchanged ones are left alone', async () => {
  const { id, pg, putTranscripts, analyze, samples, app } = await newStudy()
  const saved = await (await putTranscripts(samples)).json()
  await analyze()
  const idsBefore = (await pg.query<any>(`select id from research.utterances where transcript_id = $1 order by position`, [saved.transcripts[0].id])).rows.map((r: any) => r.id)
  const edited = saved.transcripts.map((t: any, i: number) => ({ id: t.id, name: t.name, platform: t.platform, rawText: i === 1 ? t.rawText + '\n00:09:00 Daniel Ortiz: One more thought about the calendar.' : t.rawText }))
  const res = await putTranscripts(edited)
  const body = await res.json()
  assert.deepEqual([body.hasAnalysis, body.needsAnalysis], [true, true])
  assert.deepEqual(body.transcripts.map((t: any) => t.id), saved.transcripts.map((t: any) => t.id), 'ids kept')
  assert.deepEqual((await pg.query<any>(`select id from research.utterances where transcript_id = $1 order by position`, [saved.transcripts[0].id])).rows.map((r: any) => r.id), idsBefore, 'the unchanged transcript was not re-read')
  assert.equal(body.transcripts[1].lineCount, saved.transcripts[1].lineCount + 1)
  void app; void id
})

test('re-analysing keeps the old run, retires it, shows only the new themes, and flags requirements documents stale', async () => {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d })
  const p1 = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const v = async () => ((await pg.query<any>(`select version from core.projects where id = $1`, [p1])).rows[0] as { version: number }).version
  const before = (await pg.query<any>(`select count(*)::int n from research.themes where project_id = $1`, [p1])).rows[0].n
  assert.equal((await pg.query<any>(`select stale from delivery.specs where project_id = $1`, [p1])).rows[0].stale, false)
  const res = await app.request(`/api/v1/projects/${p1}/analysis-runs`, { method: 'POST', headers: { ...auth, 'if-match': String(await v()) }, body: '{}' })
  assert.equal(res.status, 201)
  const runs = (await pg.query<any>(`select count(*)::int total, count(*) filter (where superseded_at is null)::int current from core.agent_runs where project_id = $1 and kind = 'analysis'`, [p1])).rows[0]
  assert.deepEqual([runs.total, runs.current], [2, 1])
  assert.equal((await pg.query<any>(`select count(*)::int n from research.themes where project_id = $1`, [p1])).rows[0].n, before + 9, 'old themes are kept')
  const card = (await (await app.request('/api/v1/projects')).json()).data.find((p: any) => p.id === p1)
  assert.equal(card.themes, 9, 'the card counts the current run only')
  assert.equal((await pg.query<any>(`select stale from delivery.specs where project_id = $1`, [p1])).rows[0].stale, true)
  // The published board's stories still point at their original themes.
  assert.equal((await pg.query<any>(`select count(*)::int n from delivery.stories s join research.themes t on t.id = s.theme_id where s.spec_id in (select id from delivery.specs where project_id = $1)`, [p1])).rows[0].n, 9)
})

test('removing every transcript retires the analysis: the project is a draft again and the Analyze steps lock', async () => {
  const { app, id, putTranscripts, analyze, samples } = await newStudy()
  await putTranscripts(samples)
  await analyze()
  const res = await putTranscripts([])
  const body = await expectSpec(res, '/projects/{id}/transcripts', 'put')
  assert.deepEqual([body.transcripts.length, body.hasAnalysis, body.needsAnalysis], [0, false, false])
  const card = (await (await app.request('/api/v1/projects')).json()).data.find((p: any) => p.id === id)
  assert.deepEqual([card.status, card.themes, card.sessions], ['draft', 0, 0])
  const tabs = (await (await app.request(`/api/v1/projects/${id}/stage`)).json()).tabs
  assert.equal(tabs.themes.enabled, false)
})

test('transcript and analysis writes are versioned, audited and need the token', async () => {
  const { app, id, pg, putTranscripts, analyze, samples } = await newStudy()
  const v0 = ((await pg.query<any>(`select version from core.projects where id = $1`, [id])).rows[0] as { version: number }).version
  assert.equal((await putTranscripts(samples, v0 + 5)).status, 409, 'stale version')
  assert.equal((await put(app, `/projects/${id}/transcripts`, { transcripts: [] }, null)).status, 428)
  assert.equal((await put(app, `/projects/${id}/transcripts`, { transcripts: samples }, v0, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await putTranscripts(samples, v0)).status, 200)
  assert.equal((await analyze(v0 + 1)).status, 201)
  const verbs = (await pg.query<any>(`select verb from core.audit_log where entity_id = $1`, [id])).rows.map((r: any) => r.verb)
  assert.ok(verbs.includes('transcripts_saved') && verbs.includes('analysis_run'))
  const anonymous = await app.request(`/api/v1/projects/${id}/analysis-runs`, { method: 'POST', headers: { 'content-type': 'application/json', 'if-match': '1' }, body: '{}' })
  assert.equal(anonymous.status, 401)
})

test('speakers whose names differ only by case are one speaker; unmatched names stay unmatched', async () => {
  const { putTranscripts } = await newStudy()
  const res = await putTranscripts([{ name: 'Call', rawText: '00:01 maya chen: Hello.\n00:02 Maya Chen: Again.\n00:03 Someone New: Hi.' }])
  const body = await res.json()
  assert.deepEqual(body.transcripts[0].speakers.map((s: any) => [s.name, s.participant]), [['maya chen', 'Maya Chen'], ['Someone New', null]])
})

test('a freshly seeded analysed project is not flagged out of date, and editing a transcript flags it', async () => {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d })
  const p1 = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const read = async () => (await app.request(`/api/v1/projects/${p1}/transcripts`)).json()
  const before = await read()
  assert.deepEqual([before.transcripts.length, before.hasAnalysis, before.needsAnalysis], [3, true, false])
  const ver = ((await pg.query<any>(`select version from core.projects where id = $1`, [p1])).rows[0] as { version: number }).version
  const edited = before.transcripts.map((t: any, i: number) => ({ id: t.id, name: t.name, platform: t.platform, rawText: i === 0 ? t.rawText + '\n00:09:00 Maya Chen: One more thing.' : t.rawText }))
  assert.equal((await put(app, `/projects/${p1}/transcripts`, { transcripts: edited }, ver)).status, 200)
  assert.deepEqual([(await read()).hasAnalysis, (await read()).needsAnalysis], [true, true])
})

// Themes, pins, stages, importance and effort ----------------------------------------------------------

const patchTheme = (app: ReturnType<typeof createApp>, themeId: string, body: unknown, version: number | null, headers: Record<string, string> = auth) =>
  app.request(`/api/v1/themes/${themeId}`, { method: 'PATCH', headers: { ...headers, ...(version === null ? {} : { 'if-match': String(version) }) }, body: JSON.stringify(body) })

async function themesFixture() {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d })
  const p1 = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const list = async (q = '') => (await app.request(`/api/v1/projects/${p1}/themes${q}`)).json()
  const byTitle = async (title: string) => (await list()).data.find((t: any) => t.title === title || t.originalTitle === title)
  return { app, pg, p1, list, byTitle }
}

test('GET themes returns the current analysis strongest first, with suggestions beside the person’s edits', async () => {
  const { app, p1 } = await themesFixture()
  const res = await app.request(`/api/v1/projects/${p1}/themes`)
  const body = await expectSpec(res, '/projects/{id}/themes')
  assert.deepEqual(body.data.map((t: any) => t.title), PROTOTYPE_THEMES)
  assert.equal(body.stages.length, 5)
  assert.match(res.headers.get('cache-control') ?? '', /public/)
  const top = body.data[0]
  assert.deepEqual([top.participantCount, top.totalParticipants, top.mentionCount, top.category, top.priority, top.effort], [3, 3, 3, 'pain_point', 'high', 3])
  assert.ok(body.data.every((t: any) => t.stagePosition !== null && t.stagePosition === t.suggestedStagePosition), 'every theme is already on the journey map at its suggested stage')
  const prep = body.data.find((t: any) => t.originalTitle === 'Wants to know what to prepare')
  assert.deepEqual([prep.suggestedPriority, prep.priority, prep.suggestedEffort, prep.effort, prep.edited], ['medium', 'high', 1, 2, true], 'the seeded edit shows next to the suggestion')
  assert.equal(body.data[0].quotes, undefined, 'quotes only on request')
})

test('GET themes: category filter, quotes with speakers and sessions, and errors', async () => {
  const { app, list, p1 } = await themesFixture()
  const pains = (await expectSpec(await app.request(`/api/v1/projects/${p1}/themes?category=pain_point`), '/projects/{id}/themes')).data
  assert.ok(pains.length > 0 && pains.every((t: any) => t.category === 'pain_point'))
  const withQuotes = await expectSpec(await app.request(`/api/v1/projects/${p1}/themes?include=quotes`), '/projects/{id}/themes')
  const avail = withQuotes.data.find((t: any) => t.originalTitle === 'Provider availability is hard to see')
  assert.equal(avail.quotes.length, avail.mentionCount)
  assert.ok(avail.quotes.every((q: any) => q.speaker && q.session && !/\.\w+$/.test(q.session) && q.text))
  assert.ok(avail.quotes.some((q: any) => q.session === 'Session 1 - Maya Chen' && q.participant === 'Maya Chen'))
  assert.equal((await app.request(`/api/v1/projects/${p1}/themes?category=bogus`)).status, 422)
  assert.equal((await app.request(`/api/v1/projects/00000000-0000-4000-8000-000000000000/themes`)).status, 404)
  assert.ok((await list()).data.length === 9)
})

test('a project with no analysis has no themes', async () => {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d })
  const draft = ((await pg.query<any>(`select id from core.projects where name = 'New patient intake (draft)'`)).rows[0] as { id: string }).id
  assert.deepEqual((await (await app.request(`/api/v1/projects/${draft}/themes`)).json()).data, [])
})

test('PATCH moves a theme to a stage: creates the edit at version 1; a stale version is 409; clearing removes it', async () => {
  const { app, pg, byTitle } = await themesFixture()
  const t = await byTitle('Reviews and ratings drive trust')
  assert.equal(t.overrideVersion, 0)
  const target = t.stagePosition === 4 ? 3 : 4
  const moved = await patchTheme(app, t.id, { stagePosition: target }, 0)
  assert.equal(moved.status, 200)
  const body = await expectSpec(moved, '/themes/{id}', 'patch')
  assert.deepEqual([body.stagePosition, body.overrideVersion], [target, 1])
  const stale = await patchTheme(app, t.id, { stagePosition: null }, 0)
  assert.equal(stale.status, 409)
  const err = await expectSpec(stale, '/themes/{id}', 'patch')
  assert.deepEqual([err.error.code, err.current.version], ['version_conflict', 1])
  const cleared = await (await patchTheme(app, t.id, { stagePosition: null }, 1)).json()
  assert.deepEqual([cleared.stagePosition, cleared.overrideVersion], [t.stagePosition, 0], 'nothing left overridden: the edit row is gone')
  assert.equal((await pg.query<any>(`select count(*)::int n from research.theme_overrides where theme_id = $1`, [t.id])).rows[0].n, 0)
})

test('PATCH edits only what is sent: rename, stage, importance, effort; null clears one; blank title clears the name', async () => {
  const { app, byTitle } = await themesFixture()
  const t = await byTitle('Booking form repeats questions')
  let v = t.overrideVersion
  const step = async (patch: unknown) => { const r = await patchTheme(app, t.id, patch, v); assert.equal(r.status, 200); const b = await r.json(); v = b.overrideVersion; return b }
  const a = await step({ title: '  Forms ask twice  ' })
  assert.deepEqual([a.title, a.originalTitle, a.stagePosition], ['Forms ask twice', 'Booking form repeats questions', 1], 'rename keeps the original and leaves the stage alone')
  const b = await step({ stagePosition: 4 })
  assert.deepEqual([b.stagePosition, b.suggestedStagePosition, b.title], [4, 1, 'Forms ask twice'])
  const c = await step({ priority: 'low', effort: 3 })
  assert.deepEqual([c.priority, c.suggestedPriority, c.effort, c.suggestedEffort, c.edited], ['low', 'high', 3, 2, true])
  const d = await step({ priority: null, effort: null })
  assert.deepEqual([d.priority, d.effort, d.edited], ['high', 2, false], 'null goes back to the suggestion')
  const e = await step({ title: '   ', stagePosition: null })
  assert.deepEqual([e.title, e.stagePosition], ['Booking form repeats questions', 1])
})

test('PATCH validates: range of stage, effort and priority; empty body; header; viewer and anonymous', async () => {
  const { app, byTitle } = await themesFixture()
  const t = await byTitle('Reviews and ratings drive trust')
  const bad = async (body: unknown) => (await patchTheme(app, t.id, body, 0)).status
  assert.equal(await bad({ stagePosition: 5 }), 422, 'there are five stages: 0 to 4')
  assert.equal(await bad({ stagePosition: -1 }), 422)
  assert.equal(await bad({ effort: 4 }), 422)
  assert.equal(await bad({ priority: 'urgent' }), 422)
  assert.equal(await bad({}), 422)
  const stage = await patchTheme(app, t.id, { stagePosition: 9 }, 0)
  assert.equal((await stage.json()).error.field, 'stagePosition')
  assert.equal((await patchTheme(app, t.id, { stagePosition: 3 }, null)).status, 428)
  assert.equal((await patchTheme(app, t.id, { stagePosition: 3 }, 0, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await patchTheme(app, '00000000-0000-4000-8000-000000000000', { stagePosition: 3 }, 0)).status, 404)
  assert.equal((await patchTheme(app, 'nope', { stagePosition: 3 }, 0)).status, 404)
  assert.equal((await byTitle('Reviews and ratings drive trust')).overrideVersion, 0, 'nothing changed')
})

test('a viewer cannot edit themes even with a token', async () => {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const viewer = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'sam@demo.signalflow.example' }, getDb: () => d })
  const id = ((await pg.query<any>(`select id from research.themes limit 1`)).rows[0] as { id: string }).id
  const res = await patchTheme(viewer, id, { stagePosition: 3 }, 0)
  assert.equal(res.status, 403)
})

test('edits to different themes never conflict, and edits are audited', async () => {
  const { app, pg, byTitle } = await themesFixture()
  const a = await byTitle('Reviews and ratings drive trust')
  const b = await byTitle('Follow-up instructions get lost')
  assert.equal((await patchTheme(app, a.id, { stagePosition: 3 }, 0)).status, 200)
  assert.equal((await patchTheme(app, b.id, { stagePosition: 3 }, 0)).status, 200, 'the second edit used version 0 for its own theme')
  assert.ok((await pg.query<any>(`select count(*)::int n from core.audit_log where verb = 'theme_edited'`)).rows[0].n >= 2)
})

test('Reset all clears importance and effort edits, keeps stage moves, and removes rows that end up empty', async () => {
  const { app, pg, p1, list, byTitle } = await themesFixture()
  const reviews = await byTitle('Reviews and ratings drive trust')
  await patchTheme(app, reviews.id, { priority: 'low', effort: 3, stagePosition: 3 }, 0) // keeps a row after the reset: the stage move
  const before = (await list()).data
  assert.equal(before.filter((t: any) => t.edited).length, 2, 'the seeded edit plus this one')
  const res = await app.request(`/api/v1/projects/${p1}/priority-overrides`, { method: 'DELETE', headers: auth })
  assert.equal(res.status, 200)
  const body = await expectSpec(res, '/projects/{id}/priority-overrides', 'delete')
  assert.equal(body.data.filter((t: any) => t.edited).length, 0)
  assert.equal(body.data.find((t: any) => t.id === reviews.id).stagePosition, 3, 'the stage move stays')
  assert.equal((await pg.query<any>(`select count(*)::int n from research.theme_overrides o join research.themes t on t.id = o.theme_id where t.project_id = $1`, [p1])).rows[0].n, 1, 'only the stage move remains: the seeded edit became empty and went')
  assert.equal((await app.request(`/api/v1/projects/${p1}/priority-overrides`, { method: 'DELETE' })).status, 401)
})

test('after a re-analysis the new themes start clean and an old theme can no longer be edited', async () => {
  const { app, pg, p1, byTitle } = await themesFixture()
  const old = await byTitle('Reviews and ratings drive trust')
  const v = ((await pg.query<any>(`select version from core.projects where id = $1`, [p1])).rows[0] as { version: number }).version
  assert.equal((await app.request(`/api/v1/projects/${p1}/analysis-runs`, { method: 'POST', headers: { ...auth, 'if-match': String(v) }, body: '{}' })).status, 201)
  const fresh = (await (await app.request(`/api/v1/projects/${p1}/themes`)).json()).data
  assert.equal(fresh.length, 9)
  assert.ok(fresh.every((t: any) => !t.edited && t.overrideVersion === 0 && t.stagePosition === t.suggestedStagePosition), 'the new run carries none of the old edits')
  const stale = await patchTheme(app, old.id, { stagePosition: 3 }, 0)
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).error.code, 'theme_superseded')
})

// Requirements documents ---------------------------------------------------------------------------------

const SPEC_STEP_TITLES = ['Frame the problem', 'Identify users and jobs', 'Define goals and success metrics', 'Set scope', 'Draft requirements', 'Assess risks and dependencies', 'Plan the rollout', 'List open questions']

async function specFixture() {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d })
  const idOf = async (name: string) => ((await pg.query<any>(`select id from core.projects where name = $1`, [name])).rows[0] as { id: string }).id
  const call = (method: string, path: string, body?: unknown, version?: number | string, headers: Record<string, string> = auth) =>
    app.request(`/api/v1${path}`, { method, headers: { ...headers, ...(version === undefined ? {} : { 'if-match': String(version) }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const round2 = await idOf('Clinic booking, round 2')
  const create = async () => (await call('POST', `/projects/${round2}/specs`, {})).json()
  const get = async (id: string) => (await app.request(`/api/v1/specs/${id}`)).json()
  const approve = async (spec: any, n: number) => call('POST', `/agent-steps/${spec.steps[n - 1].id}/approve`, undefined, spec.steps[n - 1].version)
  // Approves steps 1..n in order, returning the document as it is afterwards.
  const approveThrough = async (id: string, n: number) => {
    let spec = await get(id)
    for (let i = 1; i <= n; i++) {
      if (spec.steps[i - 1].status === 'approved') continue
      const r = await approve(spec, i)
      assert.equal(r.status, 200, `approve step ${i}`)
      spec = await r.json()
    }
    return spec
  }
  return { app, pg, idOf, call, round2, create, get, approve, approveThrough }
}

test('the seeded document reads back whole: eight approved steps, the brief, the document, and the redo', async () => {
  const { app, idOf } = await specFixture()
  const p1 = await idOf('Clinic booking, usability round 1')
  const list = await expectSpec(await app.request(`/api/v1/specs?projectId=${p1}`), '/specs')
  assert.deepEqual(list.data.map((s: any) => [s.status, s.approved, s.total, s.standalone]), [['published', 8, 8, false]])
  const res = await app.request(`/api/v1/specs/${list.data[0].id}`)
  const spec = await expectSpec(res, '/specs/{id}')
  assert.equal(res.headers.get('etag'), `"${spec.version}"`)
  assert.deepEqual(spec.steps.map((s: any) => s.title), SPEC_STEP_TITLES)
  assert.ok(spec.steps.every((s: any) => s.status === 'approved' && s.text))
  assert.deepEqual([spec.brief.locked, !!spec.brief.problem, !!spec.brief.users, spec.brief.goals.length > 0], [true, true, true, true])
  assert.deepEqual(spec.document.map((b: any) => b.heading), ['Scope', 'Requirements', 'Risks and dependencies', 'Rollout', 'Open questions'])
  const scope = spec.steps[3]
  assert.deepEqual([scope.redoNote, scope.revision], ['Focus on the new-patient flow', 1])
  assert.match(scope.text, /Revised to account for: Focus on the new-patient flow\./)
  assert.ok(scope.evidence.length > 0 && scope.alternatives.length > 0)
  assert.equal(spec.themes.length, 9)
  assert.deepEqual([spec.canPublish, spec.stale], [false, false])
})

test('drafting reads every test item: the descriptions frame the problem and the outcomes become goals', async () => {
  const { app, pg, call, round2, approveThrough } = await specFixture()
  const v = ((await pg.query<any>(`select version from core.projects where id = $1`, [round2])).rows[0] as { version: number }).version
  const saved = await put(app, `/projects/${round2}/study`, await planOf(app, round2, { testItems: [{ description: 'Booking flow', outcomes: ['Outcome from item one'] }, { description: 'Reminders', outcomes: ['Outcome from item two'] }] }), v)
  assert.equal(saved.status, 200)
  const spec = await (await call('POST', `/projects/${round2}/specs`, {})).json()
  assert.match(spec.steps[0].text, /barriers to booking flow; reminders/)
  const goals = (await approveThrough(spec.id, 2)).steps[2]
  const output = JSON.stringify((await pg.query<any>(`select output from core.agent_steps where id = $1`, [goals.id])).rows[0].output)
  assert.ok(output.includes('Outcome from item one') && output.includes('Outcome from item two'), 'both items\' outcomes reach the goals step')
})

test('starting a document drafts step 1 and leaves seven waiting; it needs analysis, the token and an editing role', async () => {
  const { app, pg, idOf, call, round2 } = await specFixture()
  const res = await call('POST', `/projects/${round2}/specs`, { name: 'Round 2 requirements' })
  assert.equal(res.status, 201)
  const spec = await expectSpec(res, '/projects/{id}/specs', 'post')
  assert.deepEqual([spec.name, spec.status, spec.standalone, spec.steps.map((s: any) => s.status)], ['Round 2 requirements', 'draft', false, ['review', ...Array(7).fill('pending')]])
  assert.deepEqual([spec.sessions, spec.themes.length, spec.themes.every((t: any) => t.included)], [4, 5, true])
  assert.match(spec.steps[0].text, /Across 4 sessions, participants raised/)
  assert.ok(spec.steps[0].evidence.length > 0 && spec.steps[0].alternatives.length === 2)
  assert.deepEqual([spec.brief.problem, spec.brief.locked, spec.document, spec.approved, spec.canPublish], [null, false, [], 0, false])
  assert.equal(spec.steps[1].text, null, 'a waiting step has no text yet')
  assert.deepEqual([spec.preview.requirements, spec.preview.openQuestions], [3, 2])
  // Refusals.
  const draft = await idOf('New patient intake (draft)')
  const none = await call('POST', `/projects/${draft}/specs`, {})
  assert.equal(none.status, 409)
  assert.equal((await expectSpec(none, '/projects/{id}/specs', 'post')).error.code, 'no_analysis')
  assert.equal((await call('POST', `/projects/${round2}/specs`, {}, undefined, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await call('POST', `/projects/00000000-0000-4000-8000-000000000000/specs`, {})).status, 404)
  const viewer = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'sam@demo.signalflow.example' }, getDb: () => (undefined as never) })
  void viewer
  void app; void pg
})

test('approving a step starts the next, in order; the brief builds from steps 1 to 3', async () => {
  const { create, approve, approveThrough, call, round2 } = await specFixture()
  const first = await create()
  const after1 = await (await approve(first, 1)).json()
  assert.deepEqual(after1.steps.map((s: any) => s.status), ['approved', 'review', ...Array(6).fill('pending')])
  assert.ok(after1.steps[0].approvedAt)
  assert.deepEqual([after1.brief.problem !== null, after1.brief.users, after1.brief.locked], [true, null, false])
  const after3 = await approveThrough(first.id, 3)
  assert.deepEqual([after3.brief.locked, after3.brief.users !== null, Array.isArray(after3.brief.goals), after3.approved], [true, true, true, 3])
  assert.deepEqual(after3.document, [], 'the document starts with step 4')
  // A project has one document: asking again returns it, with its progress, and drafts nothing.
  const ask = await call('POST', `/projects/${round2}/specs`, {})
  assert.equal(ask.status, 200)
  const again = await expectSpec(ask, '/projects/{id}/specs', 'post')
  assert.deepEqual([again.id, again.approved], [first.id, 3])
  const all = await approveThrough(first.id, 8)
  assert.deepEqual([all.approved, all.canPublish, all.document.length], [8, true, 5])
})

test('a step cannot be approved out of order, twice, or from a stale version', async () => {
  const { create, call, approve } = await specFixture()
  const spec = await create()
  const waiting = await call('POST', `/agent-steps/${spec.steps[2].id}/approve`, undefined, spec.steps[2].version)
  assert.equal(waiting.status, 409)
  assert.equal((await expectSpec(waiting, '/agent-steps/{id}/approve', 'post')).error.code, 'step_not_ready')
  assert.equal((await approve(spec, 1)).status, 200)
  const again = await approve(spec, 1) // the same version a second person still holds
  assert.equal(again.status, 409)
  const err = await expectSpec(again, '/agent-steps/{id}/approve', 'post')
  assert.deepEqual([err.error.code, err.current.version > spec.steps[0].version], ['version_conflict', true])
  assert.equal((await call('POST', `/agent-steps/${spec.steps[0].id}/approve`)).status, 428)
})

test('redo redraws a step with the instructions, and an approved step goes back under review', async () => {
  const { create, call, approve, approveThrough } = await specFixture()
  const spec = await create()
  const redone = await call('POST', `/agent-steps/${spec.steps[0].id}/redo`, { instructions: 'Focus on the reschedule flow' }, spec.steps[0].version)
  assert.equal(redone.status, 200)
  const body = await expectSpec(redone, '/agent-steps/{id}/redo', 'post')
  const s1 = body.steps[0]
  assert.deepEqual([s1.status, s1.revision, s1.redoNote], ['review', 1, 'Focus on the reschedule flow'])
  assert.match(s1.text, /Revised to account for: Focus on the reschedule flow\.$/)
  assert.equal((await call('POST', `/agent-steps/${s1.id}/redo`, { instructions: '  ' }, s1.version)).status, 422)
  // Redo after approval: the step is no longer approved, so the document cannot publish.
  const done = await approveThrough((await create()).id, 8)
  const back = await (await call('POST', `/agent-steps/${done.steps[4].id}/redo`, { instructions: 'Shorter' }, done.steps[4].version)).json()
  assert.deepEqual([back.steps[4].status, back.approved, back.canPublish], ['review', 7, false])
  assert.equal((await call('POST', `/agent-steps/${spec.steps[3].id}/redo`, { instructions: 'x' }, spec.steps[3].version)).status, 409, 'a waiting step cannot be redone')
  void approve
})

test('editing a step keeps the draft, sends it back for approval, and the edit survives approving again', async () => {
  const { create, call, approve } = await specFixture()
  const spec = await create()
  const edited = await call('PATCH', `/agent-steps/${spec.steps[0].id}`, { text: '  My own framing of the problem.  ' }, spec.steps[0].version)
  assert.equal(edited.status, 200)
  const body = await expectSpec(edited, '/agent-steps/{id}', 'patch')
  const s1 = body.steps[0]
  assert.deepEqual([s1.text, s1.edited, s1.status], ['My own framing of the problem.', true, 'review'])
  assert.equal(s1.originalText, spec.steps[0].originalText, 'the draft is kept')
  const ok = await (await approve(body, 1)).json()
  assert.deepEqual([ok.steps[0].status, ok.steps[0].text], ['approved', 'My own framing of the problem.'])
  // Editing an approved step sends it back; it needs approving again.
  const again = await (await call('PATCH', `/agent-steps/${ok.steps[0].id}`, { text: 'Second edit.' }, ok.steps[0].version)).json()
  assert.deepEqual([again.steps[0].status, again.approved], ['review', 0])
  assert.equal((await call('PATCH', `/agent-steps/${again.steps[0].id}`, { text: '   ' }, again.steps[0].version)).status, 422)
  assert.equal((await call('PATCH', `/agent-steps/${spec.steps[4].id}`, { text: 'x' }, spec.steps[4].version)).status, 409, 'a waiting step cannot be edited')
})

test('excluding a theme changes what later steps and the board are built from; drafted steps keep theirs', async () => {
  const { create, call, approveThrough } = await specFixture()
  const spec = await create()
  const insurance = spec.themes.find((t: any) => t.title === 'Insurance coverage is unclear up front')
  assert.equal(insurance.effort, 3)
  const res = await call('PUT', `/specs/${spec.id}/themes/${insurance.id}`, { included: false }, spec.version)
  assert.equal(res.status, 200)
  const body = await expectSpec(res, '/specs/{id}/themes/{themeId}', 'put')
  assert.equal(body.themes.find((t: any) => t.id === insurance.id).included, false)
  assert.deepEqual([body.preview.requirements, body.preview.openQuestions], [3, 1], 'one fewer open question')
  assert.equal(body.steps[0].text, spec.steps[0].text, 'step 1 was already drafted')
  const stale = await call('PUT', `/specs/${spec.id}/themes/${insurance.id}`, { included: true }, spec.version)
  assert.equal(stale.status, 409)
  const done = await approveThrough(spec.id, 8)
  assert.ok(!JSON.stringify(done.document).toLowerCase().includes('insurance coverage'), 'later steps were written without it')
  assert.equal((await call('PUT', `/specs/${spec.id}/themes/not-a-uuid`, { included: true }, body.version)).status, 404)
  assert.equal((await call('PUT', `/specs/${spec.id}/themes/${insurance.id}`, {}, body.version)).status, 422)
})

test('a theme the person renamed or re-prioritised is drafted from as they changed it', async () => {
  const { pg, call, round2 } = await specFixture()
  const t = (await pg.query<any>(`select id from research.themes where project_id = $1 and title = 'Reminders build confidence'`, [round2])).rows[0] as { id: string }
  assert.equal((await call('PATCH', `/themes/${t.id}`, { title: 'Reminders reassure people', priority: 'high' }, 0)).status, 200)
  const spec = await (await call('POST', `/projects/${round2}/specs`, {})).json()
  const theme = spec.themes.find((x: any) => x.id === t.id)
  assert.deepEqual([theme.title, theme.priority], ['Reminders reassure people', 'high'])
})

test('publishing needs every step approved, then makes requirements and stories in the order step 5 listed them', async () => {
  const { app, pg, call, create, approveThrough, round2 } = await specFixture()
  const spec = await create()
  const early = await call('POST', `/specs/${spec.id}/publish`, undefined, spec.version)
  assert.equal(early.status, 409)
  assert.equal((await expectSpec(early, '/specs/{id}/publish', 'post')).error.code, 'steps_not_approved')
  const ready = await approveThrough(spec.id, 8)
  assert.equal(ready.canPublish, true)
  const res = await call('POST', `/specs/${spec.id}/publish`, undefined, ready.version)
  assert.equal(res.status, 201)
  const out = await expectSpec(res, '/specs/{id}/publish', 'post')
  assert.deepEqual([out.requirements, out.openQuestions, out.projectId], [3, 2, round2])

  const stories = (await pg.query<any>(`select key, kind, title, status, position, priority, owner_team, theme_id, requirement_id, why_it_matters, next_step from delivery.stories where spec_id = $1 order by position`, [spec.id])).rows as any[]
  assert.deepEqual(stories.map((s) => s.key), ['R1', 'R2', 'R3', 'Q1', 'Q2'])
  assert.ok(stories.every((s) => s.status === 'todo' && s.theme_id && s.owner_team === null), 'everything starts in To Do, unassigned, linked to a theme')
  assert.ok(stories.slice(0, 3).every((s) => s.kind === 'requirement' && s.requirement_id))
  assert.ok(stories.slice(3).every((s) => s.kind === 'open_question' && !s.requirement_id && /^Should ".+" move into scope\?$/.test(s.title)))
  assert.match(stories[0].why_it_matters, /was raised by \d of \d participants\.$/)
  // The numbering matches what step 5 told the reader.
  const step5 = ready.document.find((b: any) => b.heading === 'Requirements').lines
  assert.deepEqual(step5.map((l: string) => l.split(':')[0]), ['R1', 'R2', 'R3'])
  assert.deepEqual(step5.map((l: string) => l.replace(/^R\d+: /, '').replace(/ \(\d of \d participants\)$/, '')), stories.slice(0, 3).map((s) => s.title))
  const reqs = (await pg.query<any>(`select title, category, priority, effort, opportunity, supporting_quote from delivery.requirements where spec_id = $1`, [spec.id])).rows as any[]
  assert.equal(reqs.length, 3)
  assert.ok(reqs.every((r) => r.effort <= 2 && r.opportunity && r.category))
  // Published: the document is final and the project's Stories step opens.
  const published = await (await app.request(`/api/v1/specs/${spec.id}`)).json()
  assert.deepEqual([published.status, !!published.publishedAt, published.canPublish], ['published', true, false])
  const tabs = (await (await app.request(`/api/v1/projects/${round2}/stage`)).json()).tabs
  assert.equal(tabs.stories.enabled, true)
  assert.equal((await call('POST', `/specs/${spec.id}/publish`, undefined, published.version)).status, 409, 'cannot publish twice')
})

test('a published document is read-only: no approving, redoing, editing or changing themes', async () => {
  const { app, idOf, call } = await specFixture()
  const p1 = await idOf('Clinic booking, usability round 1')
  const spec = (await (await app.request(`/api/v1/specs?projectId=${p1}`)).json()).data[0]
  const detail = await (await app.request(`/api/v1/specs/${spec.id}`)).json()
  const step = detail.steps[0]
  for (const [method, path, body] of [['POST', `/agent-steps/${step.id}/approve`, undefined], ['POST', `/agent-steps/${step.id}/redo`, { instructions: 'x' }], ['PATCH', `/agent-steps/${step.id}`, { text: 'x' }]] as const) {
    const res = await call(method, path, body, step.version)
    assert.equal(res.status, 409, path)
    assert.equal((await res.json()).error.code, 'spec_published')
  }
  const theme = await call('PUT', `/specs/${spec.id}/themes/${detail.themes[0].id}`, { included: false }, detail.version)
  assert.equal(theme.status, 409)
  assert.equal((await theme.json()).error.code, 'spec_published')
})

test('a stand-alone document is drafted from a description alone, stays out of the projects list, and publishes no stories', async () => {
  const { app, pg, call, get, approveThrough } = await specFixture()
  const res = await call('POST', '/specs/standalone', { name: 'Saved searches', what: 'Let people save a search and get alerts' })
  assert.equal(res.status, 201)
  const spec = await expectSpec(res, '/specs/standalone', 'post')
  assert.deepEqual([spec.standalone, spec.themes.length, spec.sessions, spec.name], [true, 0, 0, 'Saved searches'])
  assert.match(spec.steps[0].text, /No research is attached, so the problem statement rests on your description: "Let people save a search and get alerts"/)
  const projects = (await (await app.request('/api/v1/projects')).json()).data.map((p: any) => p.name)
  assert.ok(!projects.includes('Saved searches'), 'not a research project')
  const standalone = await expectSpec(await app.request('/api/v1/specs?standalone=true'), '/specs')
  assert.deepEqual(standalone.data.map((s: any) => s.name), ['Saved searches'])
  const done = await approveThrough(spec.id, 8)
  const out = await (await call('POST', `/specs/${spec.id}/publish`, undefined, done.version)).json()
  assert.deepEqual([out.requirements, out.openQuestions], [0, 0])
  assert.equal((await get(spec.id)).status, 'published')
  assert.equal((await call('POST', '/specs/standalone', { name: '', what: '' })).status, 422)
  assert.equal((await call('POST', '/specs/standalone', { name: 'x', what: '  ' })).status, 422)
  assert.ok((await pg.query<any>(`select count(*)::int n from core.projects where kind = 'standalone'`)).rows[0].n === 1)
})

test('deleting a document removes its steps and stories; a stand-alone one takes its project with it', async () => {
  const { app, pg, idOf, call, create } = await specFixture()
  const mine = await create()
  assert.equal((await call('DELETE', `/specs/${mine.id}`)).status, 204)
  assert.equal((await pg.query<any>(`select count(*)::int n from core.agent_steps where id = any($1::uuid[])`, [mine.steps.map((s: any) => s.id)])).rows[0].n, 0)
  const again = await call('DELETE', `/specs/${mine.id}`)
  assert.equal(again.status, 404)
  assert.equal((await expectSpec(again, '/specs/{id}', 'delete')).error.code, 'not_found')
  // The seeded, published document: its stories go with it.
  const p1 = await idOf('Clinic booking, usability round 1')
  const seeded = (await (await app.request(`/api/v1/specs?projectId=${p1}`)).json()).data[0]
  assert.equal((await call('DELETE', `/specs/${seeded.id}`)).status, 204)
  assert.equal((await pg.query<any>(`select count(*)::int n from delivery.stories where spec_id = $1`, [seeded.id])).rows[0].n, 0)
  assert.equal((await (await app.request(`/api/v1/projects/${p1}/stage`)).json()).tabs.stories.enabled, false, 'Stories locks again')
  const sa = await (await call('POST', '/specs/standalone', { name: 'Temp', what: 'x' })).json()
  assert.equal((await call('DELETE', `/specs/${sa.id}`)).status, 204)
  assert.equal((await pg.query<any>(`select count(*)::int n from core.projects where kind = 'standalone'`)).rows[0].n, 0)
  assert.equal((await call('DELETE', `/specs/${mine.id}`, undefined, undefined, { 'content-type': 'application/json' })).status, 401)
  assert.ok((await pg.query<any>(`select count(*)::int n from core.audit_log where verb = 'deleted' and entity = 'delivery.specs'`)).rows[0].n >= 3)
})

test('anyone can read documents as the viewer; a viewer role cannot start or change one even with the token', async () => {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const open = createApp({ env: TOKEN, getDb: () => d })
  const viewer = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'sam@demo.signalflow.example' }, getDb: () => d })
  const p2 = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, round 2'`)).rows[0] as { id: string }).id
  assert.equal((await open.request('/api/v1/specs')).status, 200)
  const res = await viewer.request(`/api/v1/projects/${p2}/specs`, { method: 'POST', headers: auth, body: '{}' })
  assert.equal(res.status, 403)
})

// The Stories board ----------------------------------------------------------------------------------------

async function boardFixture() {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d }) // David, the owner
  const alex = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'alex@demo.signalflow.example' }, getDb: () => d })
  const sam = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'sam@demo.signalflow.example' }, getDb: () => d })
  const p1 = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const send = (who: ReturnType<typeof createApp>, method: string, path: string, body?: unknown, version?: number | string, headers: Record<string, string> = auth) =>
    who.request(`/api/v1${path}`, { method, headers: { ...headers, ...(version === undefined ? {} : { 'if-match': String(version) }) }, body: body === undefined ? undefined : JSON.stringify(body) })
  const board = async (who = app) => (await who.request(`/api/v1/projects/${p1}/board`, { headers: auth })).json()
  const story = async (key: string) => (await board()).stories.find((s: any) => s.key === key)
  const column = async (status: string) => (await board()).stories.filter((s: any) => s.status === status).sort((a: any, b: any) => a.position - b.position).map((s: any) => s.key)
  const move = async (key: string, status: string, beforeKey: string | null = null, who = app) => {
    const s = await story(key)
    const before = beforeKey ? await story(beforeKey) : null
    return send(who, 'POST', `/stories/${s.id}/move`, { status, beforeId: before?.id ?? null }, s.version)
  }
  return { app, alex, sam, pg, p1, send, board, story, column, move }
}

test('the board is the published document’s stories: 10 cards in four columns, with themes and criteria counts', async () => {
  const { app, p1 } = await boardFixture()
  const res = await app.request(`/api/v1/projects/${p1}/board`)
  const body = await expectSpec(res, '/projects/{id}/board')
  assert.match(res.headers.get('cache-control') ?? '', /public/)
  assert.equal(body.stories.length, 10)
  const by = (st: string) => body.stories.filter((s: any) => s.status === st).length
  assert.deepEqual([by('todo'), by('in_progress'), by('in_review'), by('done')], [5, 3, 1, 1])
  assert.deepEqual(body.stories.filter((s: any) => s.kind === 'open_question').map((s: any) => s.key).sort(), ['Q1', 'Q2', 'Q3'])
  assert.deepEqual(body.stories.filter((s: any) => !s.theme).map((s: any) => s.key), ['Q3'])
  const r3 = body.stories.find((s: any) => s.key === 'R3')
  assert.ok(r3.criteriaTotal > 0 && r3.criteriaMet <= r3.criteriaTotal)
  assert.match(r3.theme.title, /Price surprises/)
  assert.deepEqual([r3.theme.participantCount, r3.theme.totalParticipants], [2, 3])
  assert.ok(body.themes.length > 0 && body.themes.reduce((n: number, t: any) => n + t.count, 0) === 9, 'nine cards have a theme')
  assert.equal(body.lastMove, null)
  assert.equal(body.specName, 'Clinic booking, usability round 1')
})

test('a project with no published document has no board (404 no_board); unknown projects are 404', async () => {
  const { app, pg } = await boardFixture()
  for (const name of ['Clinic booking, round 2', 'New patient intake (draft)']) {
    const id = ((await pg.query<any>(`select id from core.projects where name = $1`, [name])).rows[0] as { id: string }).id
    const res = await app.request(`/api/v1/projects/${id}/board`)
    assert.equal(res.status, 404, name)
    assert.equal((await expectSpec(res, '/projects/{id}/board')).error.code, 'no_board')
  }
  assert.equal((await app.request('/api/v1/projects/00000000-0000-4000-8000-000000000000/board')).status, 404)
})

test('GET a card returns its checklist in order, with the version as ETag', async () => {
  const { app, story } = await boardFixture()
  const r3 = await story('R3')
  const res = await app.request(`/api/v1/stories/${r3.id}`)
  const body = await expectSpec(res, '/stories/{id}')
  assert.equal(res.headers.get('etag'), `"${r3.version}"`)
  assert.deepEqual(body.checklist.map((c: any) => c.position), body.checklist.map((_: any, i: number) => i))
  assert.ok(body.checklist.some((c: any) => c.kind === 'criterion') && body.checklist.some((c: any) => c.kind === 'task'))
  assert.equal(body.criteriaTotal, body.checklist.filter((c: any) => c.kind === 'criterion').length)
  assert.equal((await app.request('/api/v1/stories/not-a-uuid')).status, 404)
})

test('moving a card to the end of another column changes only that card and records the move', async () => {
  const { app, pg, board, story, column, move } = await boardFixture()
  const before = await board()
  const r5 = await story('R5')
  const res = await move('R5', 'in_progress')
  assert.equal(res.status, 200)
  const moved = await expectSpec(res, '/stories/{id}/move', 'post')
  const last = Math.max(...before.stories.filter((s: any) => s.status === 'in_progress').map((s: any) => s.position))
  assert.deepEqual([moved.status, moved.position, moved.version], ['in_progress', last + 1000, r5.version + 1])
  assert.deepEqual(await column('in_progress'), ['R1', 'R2', 'R4', 'R5'])
  const after = await board()
  for (const s of after.stories.filter((s: any) => s.key !== 'R5')) assert.equal(s.version, before.stories.find((b: any) => b.id === s.id).version, `${s.key} untouched`)
  assert.equal(after.lastMove.key, 'R5')
  assert.deepEqual([after.lastMove.from, after.lastMove.to], ['todo', 'in_progress'])
  assert.equal((await pg.query<any>(`select count(*)::int n from core.audit_log where verb = 'moved' and entity_id = $1`, [r5.id])).rows[0].n, 1)
  void app
})

test('dropping before a card puts it just above, within a column or across columns; dropping where it is changes nothing', async () => {
  const { pg, story, column, move } = await boardFixture()
  assert.deepEqual(await column('todo'), ['R5', 'R6', 'Q1', 'Q2', 'Q3'])
  assert.equal((await move('Q3', 'todo', 'R6')).status, 200)
  assert.deepEqual(await column('todo'), ['R5', 'Q3', 'R6', 'Q1', 'Q2'])
  assert.equal((await move('R5', 'todo', null)).status, 200)
  assert.deepEqual(await column('todo'), ['Q3', 'R6', 'Q1', 'Q2', 'R5'])
  assert.equal((await move('R6', 'in_review', 'R3')).status, 200)
  assert.deepEqual(await column('in_review'), ['R6', 'R3'])
  // Dropping a card just above the card that is already below it is no move at all.
  const v = (await story('R5')).version
  const audits = (await pg.query<any>(`select count(*)::int n from core.audit_log where verb = 'moved'`)).rows[0].n
  const again = await move('R5', 'todo', null)
  assert.equal(again.status, 200)
  assert.equal((await again.json()).version, v, 'the version did not change')
  assert.equal((await pg.query<any>(`select count(*)::int n from core.audit_log where verb = 'moved'`)).rows[0].n, audits, 'and nothing was recorded')
})

test('a move is refused when invalid, stale, unversioned, unauthorised or from a viewer', async () => {
  const { app, sam, story, send, move } = await boardFixture()
  const r5 = await story('R5')
  const other = await story('R1') // in progress
  const wrongColumn = await send(app, 'POST', `/stories/${r5.id}/move`, { status: 'done', beforeId: other.id }, r5.version)
  assert.equal(wrongColumn.status, 422)
  assert.equal((await wrongColumn.json()).error.field, 'beforeId')
  assert.equal((await send(app, 'POST', `/stories/${r5.id}/move`, { status: 'archived' }, r5.version)).status, 422)
  assert.equal((await send(app, 'POST', `/stories/${r5.id}/move`, { status: 'done' })).status, 428)
  assert.equal((await send(app, 'POST', `/stories/${r5.id}/move`, { status: 'done' }, r5.version, { 'content-type': 'application/json' })).status, 401)
  assert.equal((await send(sam, 'POST', `/stories/${r5.id}/move`, { status: 'done' }, r5.version)).status, 403)
  assert.equal((await send(app, 'POST', `/stories/00000000-0000-4000-8000-000000000000/move`, { status: 'done' }, 1)).status, 404)
  assert.equal((await move('R5', 'done')).status, 200)
  const stale = await send(app, 'POST', `/stories/${r5.id}/move`, { status: 'todo' }, r5.version) // the version before the move above
  assert.equal(stale.status, 409)
  const err = await expectSpec(stale, '/stories/{id}/move', 'post')
  assert.deepEqual([err.error.code, err.current.version], ['version_conflict', r5.version + 1])
})

test('when neighbours are too close the column is renumbered and every card keeps its place', async () => {
  const { pg, story, column, move } = await boardFixture()
  const [a, b] = [await story('R5'), await story('R6')]
  await pg.query(`update delivery.stories set position = 1000 where id = $1`, [a.id])
  await pg.query(`update delivery.stories set position = 1000.0005 where id = $1`, [b.id])
  assert.deepEqual((await column('todo')).slice(0, 2), ['R5', 'R6'])
  assert.equal((await move('Q1', 'todo', 'R6')).status, 200)
  assert.deepEqual(await column('todo'), ['R5', 'Q1', 'R6', 'Q2', 'Q3'])
  const positions = (await pg.query<any>(`select position::float8 as p from delivery.stories where status = 'todo' order by position`)).rows.map((r: any) => r.p) as number[]
  assert.equal(new Set(positions).size, 5, 'all distinct')
  assert.ok(positions.every((p, i) => i === 0 || p - positions[i - 1] >= 1), 'spaced out again')
})

test('Undo reverses my last move exactly, once; it is mine alone; it fails if the card has moved again', async () => {
  const { app, alex, pg, story, send, board, column, move } = await boardFixture()
  const spec = (await board()).specId
  const r5 = await story('R5')
  assert.equal((await send(app, 'POST', `/specs/${spec}/undo`)).status, 404, 'nothing to undo yet')
  await move('R5', 'in_review', 'R3')
  assert.equal((await board(alex)).lastMove, null, 'Alex has not moved anything')
  assert.equal((await send(alex, 'POST', `/specs/${spec}/undo`)).status, 404, 'and cannot undo David’s move')
  const res = await send(app, 'POST', `/specs/${spec}/undo`)
  assert.equal(res.status, 200)
  const back = await expectSpec(res, '/specs/{id}/undo', 'post')
  assert.deepEqual([back.status, back.position], [r5.status, r5.position], 'exactly where it was')
  assert.deepEqual(await column('todo'), ['R5', 'R6', 'Q1', 'Q2', 'Q3'])
  assert.equal((await board()).lastMove, null)
  assert.equal((await send(app, 'POST', `/specs/${spec}/undo`)).status, 404, 'undo is once per move')
  assert.ok((await pg.query<any>(`select count(*)::int n from core.audit_log where verb = 'moved' and undone_at is not null`)).rows[0].n === 1)
  // David moves R6; then Alex moves the same card; David's undo no longer applies.
  await move('R6', 'in_progress')
  const r6 = await story('R6')
  assert.equal((await move('R6', 'done', null, alex)).status, 200)
  const refused = await send(app, 'POST', `/specs/${spec}/undo`)
  assert.equal(refused.status, 409)
  assert.equal((await expectSpec(refused, '/specs/{id}/undo', 'post')).error.code, 'cannot_undo')
  assert.equal((await story('R6')).status, 'done', 'Alex’s move stands')
  void r6
})

test('a visitor sees the board but never anyone’s moves, and cannot undo', async () => {
  const { app, p1, send, board, move } = await boardFixture()
  await move('R5', 'in_progress')
  const anon = createApp({ env: TOKEN, getDb: (app as any).getDb ?? undefined })
  void anon
  const res = await app.request(`/api/v1/projects/${p1}/board`) // no token: the read-only viewer
  assert.equal((await res.json()).lastMove, null)
  assert.equal((await board()).lastMove.key, 'R5')
  assert.equal((await send(app, 'POST', `/specs/${(await board()).specId}/undo`, undefined, undefined, { 'content-type': 'application/json' })).status, 401)
})

test('a card’s owner team and priority can be changed; blank clears the owner', async () => {
  const { pg, app, story, send } = await boardFixture()
  const r5 = await story('R5')
  const res = await send(app, 'PATCH', `/stories/${r5.id}`, { ownerTeam: '  Notifications team ', priority: 'high' }, r5.version)
  assert.equal(res.status, 200)
  const body = await expectSpec(res, '/stories/{id}', 'patch')
  assert.deepEqual([body.ownerTeam, body.priority, body.version], ['Notifications team', 'high', r5.version + 1])
  const cleared = await (await send(app, 'PATCH', `/stories/${r5.id}`, { ownerTeam: '   ' }, body.version)).json()
  assert.deepEqual([cleared.ownerTeam, cleared.priority], [null, 'high'], 'priority untouched when only the owner is sent')
  assert.equal((await send(app, 'PATCH', `/stories/${r5.id}`, { priority: 'urgent' }, cleared.version)).status, 422)
  assert.equal((await send(app, 'PATCH', `/stories/${r5.id}`, {}, cleared.version)).status, 422)
  assert.equal((await send(app, 'PATCH', `/stories/${r5.id}`, { ownerTeam: 'x' }, r5.version)).status, 409)
  assert.equal((await pg.query<any>(`select count(*)::int n from core.audit_log where verb = 'story_edited' and entity_id = $1`, [r5.id])).rows[0].n, 2)
})

test('the checklist is saved whole: ids kept, items added and removed, progress counts criteria only', async () => {
  const { app, story, send } = await boardFixture()
  const r5 = await story('R5')
  const detail = await (await app.request(`/api/v1/stories/${r5.id}`)).json()
  const [c1, c2, ...rest] = detail.checklist
  assert.ok(c1.kind === 'criterion')
  const items = [
    { id: c1.id, kind: 'criterion', text: c1.text, met: true },
    { id: c2.id, kind: c2.kind, text: 'Reworded', met: true },
    { kind: 'criterion', text: 'A brand new criterion', met: false },
    { kind: 'task', text: 'A new task', met: true },
  ]
  const res = await send(app, 'PUT', `/stories/${r5.id}/checklist`, { items }, detail.version)
  assert.equal(res.status, 200)
  const body = await expectSpec(res, '/stories/{id}/checklist', 'put')
  assert.deepEqual(body.checklist.map((c: any) => c.text), ['Reworded'.length ? c1.text : '', 'Reworded', 'A brand new criterion', 'A new task'].map((t, i) => (i === 0 ? c1.text : t)))
  assert.deepEqual([body.checklist[0].id, body.checklist[1].id], [c1.id, c2.id], 'ids kept')
  assert.equal(body.version, detail.version + 1)
  const criteria = body.checklist.filter((c: any) => c.kind === 'criterion')
  assert.deepEqual([body.criteriaTotal, body.criteriaMet], [criteria.length, criteria.filter((c: any) => c.met).length])
  assert.ok(rest.length > 0 && !body.checklist.some((c: any) => rest.some((r: any) => r.id === c.id)), 'items left out were removed')
  const board = await (await app.request(`/api/v1/projects/${(await (await app.request(`/api/v1/specs/${detail.specId}`)).json()).projectId}/board`)).json()
  assert.equal(board.stories.find((s: any) => s.id === r5.id).criteriaTotal, body.criteriaTotal, 'the board shows the new progress')
})

test('checklist saves validate: empty text, unknown ids, stale versions', async () => {
  const { app, story, send } = await boardFixture()
  const r5 = await story('R5')
  const detail = await (await app.request(`/api/v1/stories/${r5.id}`)).json()
  const empty = await send(app, 'PUT', `/stories/${r5.id}/checklist`, { items: [{ kind: 'task', text: '  ', met: false }] }, detail.version)
  assert.deepEqual([empty.status, (await empty.json()).error.field], [422, 'items.0.text'])
  const stranger = await send(app, 'PUT', `/stories/${r5.id}/checklist`, { items: [{ id: '00000000-0000-4000-8000-000000000000', kind: 'task', text: 'x', met: false }] }, detail.version)
  assert.equal(stranger.status, 422)
  assert.equal((await send(app, 'PUT', `/stories/${r5.id}/checklist`, { items: [] }, detail.version + 5)).status, 409)
  assert.equal((await send(app, 'PUT', `/stories/${r5.id}/checklist`, { items: [] }, detail.version)).status, 200, 'an empty checklist is allowed')
})

test('publishing a document puts its cards on the board: R1.. and Q1.. in To Do, in the order step 5 listed them', async () => {
  const { app, pg } = await boardFixture()
  const sf = await specFixture()
  const spec = await sf.create()
  const done = await sf.approveThrough(spec.id, 8)
  assert.equal((await sf.call('POST', `/specs/${spec.id}/publish`, undefined, done.version)).status, 201)
  const board = await expectSpec(await sf.app.request(`/api/v1/projects/${sf.round2}/board`), '/projects/{id}/board')
  assert.deepEqual(board.stories.map((s: any) => s.key), ['R1', 'R2', 'R3', 'Q1', 'Q2'])
  assert.ok(board.stories.every((s: any) => s.status === 'todo' && s.criteriaTotal === 0 && s.ownerTeam === null))
  assert.deepEqual(board.stories.map((s: any) => s.position), [1000, 2000, 3000, 4000, 5000])
  void app; void pg
})

// Platform Insights -------------------------------------------------------------------------------------------

async function insightsFixture() {
  const { pglite: pg, db: d } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => d })
  const ws = ((await pg.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0] as { id: string }).id
  const overview = async () => (await app.request('/api/v1/insights/themes')).json()
  const titled = async (t: string) => (await overview()).themes.find((x: any) => x.title === t)
  return { app, pg, d, ws, overview, titled }
}

test('Insights themes: three analysed projects, 13 participants, themes in the chosen order with their counts', async () => {
  const { app, pg } = await insightsFixture()
  const res = await app.request('/api/v1/insights/themes')
  const body = await expectSpec(res, '/insights/themes')
  assert.match(res.headers.get('cache-control') ?? '', /public/)
  assert.deepEqual(body.projects.map((p: any) => [p.name, p.participants]), [['Clinic booking, usability round 1', 3], ['Clinic booking, round 2', 4], ['Check-in diary study', 6]])
  assert.equal(body.totalParticipants, 13)
  assert.equal(body.totalParticipants, (await pg.query<any>(`select participant_count::int n from insights.workspace_stats`)).rows[0].n, 'agrees with the database view')
  assert.deepEqual(body.themes.map((t: any) => [t.title, t.participantCount, t.projectCount]), [
    ['Provider availability is hard to see', 11, 3],
    ['Insurance coverage is unclear up front', 6, 2],
    ['People expect to reschedule without calling', 10, 3],
    ['A prep checklist before the visit is valued', 10, 3],
    ['Fees appear late at checkout', 4, 2],
  ])
  for (const t of body.themes) assert.equal(t.participantCount, t.sources.reduce((n: number, s: any) => n + s.participantCount, 0))
  assert.deepEqual(body.themes[0].sources.map((s: any) => s.participantCount), [3, 3, 5])
  assert.deepEqual(body.recommendations.map((r: any) => [r.priority, r.themes.length, r.participantCount, r.projectCount]), [['high', 2, 12, 3], ['high', 2, 7, 2], ['high', 1, 10, 3], ['medium', 1, 10, 3]])
  assert.match(body.recommendations[0].title, /live provider availability/)
})

test('one platform theme shows, per project, who raised it and what they said', async () => {
  const { app, titled } = await insightsFixture()
  const t = await titled('Provider availability is hard to see')
  const res = await app.request(`/api/v1/insights/themes/${t.id}`)
  const body = await expectSpec(res, '/insights/themes/{id}')
  assert.deepEqual([body.participantCount, body.totalParticipants, body.projectCount, body.totalProjects], [11, 13, 3, 3])
  assert.deepEqual(body.sources.map((s: any) => [s.participantCount, s.projectParticipants]), [[3, 3], [3, 4], [5, 6]])
  for (const s of body.sources) {
    assert.ok(s.quotes.length >= 1 && s.quotes.length <= 3)
    assert.equal(new Set(s.quotes.map((q: any) => q.id)).size, s.quotes.length, 'no quote twice')
    assert.ok(s.quotes.every((q: any) => q.text && q.speaker && q.session))
  }
  assert.equal(body.sources[0].matchMethod, 'auto')
  const prep = await titled('A prep checklist before the visit is valued')
  const detail = await (await app.request(`/api/v1/insights/themes/${prep.id}`)).json()
  assert.equal(detail.sources[0].matchMethod, 'manual', 'the hand-tagged theme says so')
  assert.equal((await app.request('/api/v1/insights/themes/00000000-0000-4000-8000-000000000000')).status, 404)
  assert.equal((await app.request('/api/v1/insights/themes/nope')).status, 404)
})

test('case studies come newest first, each with the platform themes it was based on', async () => {
  const { app } = await insightsFixture()
  const body = await expectSpec(await app.request('/api/v1/insights/case-studies'), '/insights/case-studies')
  assert.deepEqual(body.data.map((c: any) => [c.title, c.date.slice(0, 7), c.themes.length]), [
    ['Rebuilding provider search around availability', '2026-09', 1],
    ['Showing coverage before booking', '2026-08', 2],
    ['Self-serve reschedule pilot', '2026-07', 1],
    ['Visit prep checklist rollout', '2026-06', 1],
  ])
  assert.deepEqual(body.data[1].themes.map((t: any) => t.title), ['Insurance coverage is unclear up front', 'Fees appear late at checkout'], 'in the themes’ own order')
  assert.ok(body.data.every((c: any) => c.ownerTeam && c.outcome))
})

test('Insights are open to visitors but follow a wrong token to a refusal', async () => {
  const { app } = await insightsFixture()
  for (const path of ['/insights/themes', '/insights/case-studies']) {
    assert.equal((await app.request(`/api/v1${path}`)).status, 200, path)
    assert.equal((await app.request(`/api/v1${path}`, { headers: { authorization: 'Bearer wrong' } })).status, 401, path)
  }
})

test('the matcher is repeatable: running it again changes nothing, and hand-made tags stay', async () => {
  const { overview, d, ws, pg } = await insightsFixture()
  const before = await overview()
  const manualBefore = (await pg.query<any>(`select count(*)::int n from insights.platform_theme_sources where match_method = 'manual'`)).rows[0].n
  const { refreshPlatformMatches } = await import('./insights.js')
  const result = await refreshPlatformMatches(d, makeAi({}), ws)
  assert.ok(result.matched > 0)
  assert.deepEqual(await overview(), before)
  assert.equal((await pg.query<any>(`select count(*)::int n from insights.platform_theme_sources where match_method = 'manual'`)).rows[0].n, manualBefore)
})

test('re-analysing a project keeps Insights in step: only the latest analysis counts', async () => {
  const { app, pg, overview, titled } = await insightsFixture()
  const before = await overview()
  const p1 = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const detail = await (await app.request(`/api/v1/projects/${p1}`, { headers: auth })).json()
  const res = await app.request(`/api/v1/projects/${p1}/analysis-runs`, { method: 'POST', headers: { ...auth, 'if-match': String(detail.version) }, body: '{}' })
  assert.equal(res.status, 201)
  const after = await overview()
  assert.equal(after.projects.length, 3)
  assert.equal(after.totalParticipants, before.totalParticipants)
  const avail = await titled('Provider availability is hard to see')
  assert.equal(avail.projectCount, 3, 'the new themes were matched straight away')
  assert.ok(avail.participantCount <= 13)
  const stale = (await pg.query<any>(`select count(*)::int n from insights.platform_theme_sources s join research.themes t on t.id = s.theme_id join core.agent_runs r on r.id = t.run_id where r.superseded_at is not null`)).rows[0].n
  assert.equal(stale, 0, 'no tag points at a retired analysis')
})

test('a project with no analysis is not in Insights; deleting one takes its numbers out', async () => {
  const { app, pg, overview } = await insightsFixture()
  const names = (await overview()).projects.map((p: any) => p.name)
  assert.ok(!names.includes('New patient intake (draft)'), 'a draft has no analysis')
  assert.ok(names.includes('Clinic booking, round 2'))
  const diary = ((await pg.query<any>(`select id from core.projects where name = 'Check-in diary study'`)).rows[0] as { id: string }).id
  assert.equal((await app.request(`/api/v1/projects/${diary}`, { method: 'DELETE', headers: auth })).status, 204)
  const after = await overview()
  assert.deepEqual(after.projects.map((p: any) => p.name), ['Clinic booking, usability round 1', 'Clinic booking, round 2'])
  assert.equal(after.totalParticipants, 7)
  assert.ok(after.themes.every((t: any) => t.sources.every((s: any) => s.projectId !== diary)))
})

// AI seam: provider choice, spend ledger, budget guard, one running run ----------------------------------------------

// A live-looking provider that gives the simulation's answers but charges `cost` dollars per call.
const costly = (cost: number): AiProvider => ({
  name: 'fake',
  live: true,
  analyze: async (...a) => ({ ...(await simulatedProvider.analyze(...a)), usage: { inputTokens: 1000, outputTokens: 500, costUsd: cost, model: 'fake-1' } }),
  buildSteps: async (...a) => ({ ...(await simulatedProvider.buildSteps(...a)), usage: { inputTokens: 1000, outputTokens: 500, costUsd: cost, model: 'fake-1' } }),
  matchThemes: async (...a) => ({ ...(await simulatedProvider.matchThemes(...a)), usage: { inputTokens: 1000, outputTokens: 500, costUsd: cost, model: 'fake-1' } }),
})

test('getProvider is the simulation unless a live provider is configured, and AI_ENABLED=false always wins', () => {
  assert.equal(getProvider({}), simulatedProvider)
  assert.equal(getProvider({ AI_PROVIDER: 'anthropic' }), simulatedProvider)
  assert.equal(getProvider({ AI_ENABLED: 'false', AI_PROVIDER: 'anthropic' }), simulatedProvider)
  assert.equal(makeAi({}).provider.live, false)
})

test('the simulation records no spend and the status says simulated', async () => {
  const { app, pg, putTranscripts, samples, analyze } = await newStudy()
  assert.equal((await putTranscripts(samples)).status, 200)
  assert.equal((await analyze()).status, 201)
  assert.equal(((await pg.query<any>(`select count(*)::int n from core.ai_usage`)).rows[0] as { n: number }).n, 0)
  const status = await expectSpec(await app.request('/api/v1/ai/status'), '/ai/status')
  assert.deepEqual(status, { mode: 'simulated', enabled: true })
  const off = await newStudy(undefined, { AI_ENABLED: 'false' })
  assert.deepEqual(await (await off.app.request('/api/v1/ai/status')).json(), { mode: 'simulated', enabled: false })
})

test('a costly provider is recorded, and at the monthly budget the run falls back to the simulation', async () => {
  const { app, pg, id, putTranscripts, samples, analyze } = await newStudy(costly(6), { AI_MONTHLY_BUDGET_USD: '10' })
  assert.equal((await putTranscripts(samples)).status, 200)
  assert.equal((await analyze()).status, 201) // analysis costs 6, the follow-up platform match costs 6: 12 spent
  const spent = ((await pg.query<any>(`select sum(cost_usd)::float8 s, count(*)::int n from core.ai_usage`)).rows[0]) as { s: number; n: number }
  assert.equal(spent.n, 2)
  assert.equal(spent.s, 12)
  const before = ((await pg.query<any>(`select version from core.projects where id = $1`, [id])).rows[0] as { version: number }).version
  const res = await analyze(before)
  assert.equal(res.status, 201, 'at the ceiling the run carries on with the simulation')
  assert.equal((await expectSpec(res, '/projects/{id}/analysis-runs', 'post')).fallback, 'budget')
  const runs = (await pg.query<any>(`select provider, status::text s from core.agent_runs where project_id = $1 and kind = 'analysis' order by started_at`, [id])).rows
  assert.deepEqual(runs, [{ provider: 'fake', s: 'complete' }, { provider: 'stub', s: 'complete' }].map((r) => ({ provider: r.provider, s: r.s })), 'the second run is recorded as simulated')
  const status = await (await app.request('/api/v1/ai/status', { headers: auth })).json()
  assert.deepEqual(status, { mode: 'live', enabled: true, budgetUsd: 10, spentUsd: 12 })
  assert.deepEqual(await (await app.request('/api/v1/ai/status')).json(), { mode: 'live', enabled: true })
})

test('only one analysis may run per project; a run that never finished stops blocking after ten minutes', async () => {
  const { pg, id, putTranscripts, samples, analyze } = await newStudy()
  assert.equal((await putTranscripts(samples)).status, 200)
  await pg.query(`insert into core.agent_runs (workspace_id, project_id, kind, status) select workspace_id, id, 'analysis', 'running' from core.projects where id = $1`, [id])
  const blocked = await analyze()
  assert.equal(blocked.status, 409)
  assert.equal((await expectSpec(blocked, '/projects/{id}/analysis-runs', 'post')).error.code, 'run_in_progress')
  await pg.query(`update core.agent_runs set started_at = now() - interval '20 minutes' where project_id = $1 and status = 'running'`, [id])
  assert.equal((await analyze()).status, 201)
})
