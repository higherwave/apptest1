// Run with: npm run test:api   (tsx + Node's test runner; uses an in-memory Postgres, no Neon compute)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createDemoDatabase, pgliteDb } from './test-utils.js'
import { parse } from 'yaml'
import { createApp } from './app.js'
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
  name: 'Onboarding study', templateKey: 'usability', what: 'Whether new users finish setup',
  jtbd: { when: 'I sign up', want: 'to finish setup', so: 'I can start' }, outcomes: ['Completion above 80%', ''], methods: ['Moderated usability test'],
  participants: [{ name: 'Ada Lovelace', role: 'Engineer', email: 'Ada@Example.com', sessionDate: '2026-11-02' }], ...over,
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

test('POST /projects creates the project, plan, stages, participants and starter tasks together', async () => {
  await demoDb()
  const app = createApp({ env: TOKEN, getDb: () => db })
  const res = await post(app, newProject())
  assert.equal(res.status, 201)
  const created = await expectSpec(res, '/projects', 'post')
  assert.deepEqual([created.name, created.status, created.sessions, created.themes, created.template], ['Onboarding study', 'draft', 0, 0, 'Usability test'])
  const id = created.id
  const q = async (sql: string) => (await pglite.query<any>(sql, [id])).rows as any[]
  assert.deepEqual((await q(`select what_testing w, outcomes o, methods m from research.studies where project_id = $1`))[0], { w: 'Whether new users finish setup', o: ['Completion above 80%'], m: ['Moderated usability test'] })
  assert.equal((await q(`select count(*)::int n from research.study_stages where study_id = $1`))[0].n, 5)
  assert.deepEqual((await q(`select name, email, session_date::text d from research.participants where project_id = $1`))[0], { name: 'Ada Lovelace', email: 'ada@example.com', d: '2026-11-02' })
  assert.deepEqual((await q(`select count(*) filter (where parent_task_id is null)::int q, count(*) filter (where parent_task_id is not null)::int f from research.tasks where project_id = $1`))[0], { q: 2, f: 3 })
  assert.equal((await q(`select verb from core.audit_log where entity_id = $1`))[0].verb, 'created')
  // It shows up in the list as a draft, in a tint no other project in the workspace uses yet.
  const list = (await (await app.request('/api/v1/projects')).json()).data
  const mine = list.find((p: any) => p.id === id)
  assert.equal(mine.status, 'draft')
  assert.equal(list.filter((p: any) => p.color === mine.color).length, 1)
})

test('POST /projects with the blank template starts with no tasks', async () => {
  await demoDb()
  const app = createApp({ env: TOKEN, getDb: () => db })
  const created = await (await post(app, newProject({ name: 'Blank one', templateKey: 'blank' }))).json()
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
  for (const t of ['research.studies', 'research.participants', 'research.tasks', 'research.study_stages']) {
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
