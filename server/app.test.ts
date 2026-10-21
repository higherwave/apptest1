// Run with: npm run test:api   (tsx + Node's test runner; uses an in-memory Postgres, no Neon compute)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { parse } from 'yaml'
import { createApp } from './app.js'
import { cleanConnectionString, databaseUnavailable, findConnectionString, wrapDb, type Db } from './db.js'
// @ts-expect-error plain ESM helpers shared with the db/ tooling
import { migrationFiles } from '../db/migrate.mjs'
// @ts-expect-error plain ESM seed
import { seed } from '../db/seed/seed.mjs'

const spec = parse(readFileSync(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'))

// A Db that fails the test if anything uses it: proves a route never touches the database.
const forbiddenDb: Db = { query: async () => { throw new Error('the database must not be used by this route') } }

let pglite: PGlite
let db: Db
async function demoDb() {
  if (db) return db
  pglite = new PGlite()
  for (const f of migrationFiles()) await pglite.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'))
  await pglite.exec(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz default now())`)
  for (const f of migrationFiles()) await pglite.query('insert into public.schema_migrations (name) values ($1) on conflict do nothing', [f])
  await seed(pglite)
  db = { query: async (sql, params) => pglite.query(sql, params as unknown[]) as Promise<{ rows: Record<string, any>[] }> }
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

test('DEV_TOKEN: data routes need the token; /health stays open', async () => {
  await demoDb()
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const noToken = await app.request('/api/v1/me')
  assert.equal(noToken.status, 401)
  assert.equal((await expectSpec(noToken, '/me')).error.code, 'unauthorized')
  assert.equal((await app.request('/api/v1/me', { headers: { authorization: 'Bearer wrong' } })).status, 401)
  assert.equal((await app.request('/api/v1/me', { headers: { authorization: 'Bearer s3cret' } })).status, 200)
  assert.equal((await app.request('/api/v1/health')).status, 200)
})

test('a production deployment with no DEV_TOKEN refuses data routes', async () => {
  const app = createApp({ env: { VERCEL_ENV: 'production' }, getDb: () => forbiddenDb })
  const res = await app.request('/api/v1/health/db')
  assert.equal(res.status, 401)
  assert.equal((await expectSpec(res, '/health/db')).error.code, 'auth_not_configured')
  assert.equal((await app.request('/api/v1/health')).status, 200)
})

test('a paused or unreachable database becomes a 503 db_unavailable envelope', async () => {
  const down = wrapDb({ query: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }) } })
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
  const app = createApp({ env: {}, getDb: () => ({ query: async (s, p) => empty.query(s, p as unknown[]) as Promise<{ rows: Record<string, any>[] }> }) })
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
  const routes = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method.toLowerCase()} ${r.path.replace('/api/v1', '')}`)
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
