// The real Better Auth library against a real Postgres wire connection (an in-memory PGlite behind a local socket), so the
// table and column mapping, the cookie, and our request context are exercised together. Google itself is not involved:
// the test signs up with email and password (switched on only here) and marks the email verified, as Google would.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import pg from 'pg'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { createApp } from './app.js'
import { makeBetterAuth } from './auth.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const { pglite, db } = await createDemoDatabase()
const server = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1' })
await server.start()
const address = (server as any).server?.address?.() ?? (server as any).getAddress?.()
const port = typeof address === 'object' && address ? address.port : Number(process.env.PGLITE_PORT)
const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 1 })
after(async () => {
  await pool.end()
  await server.stop()
})

const env = { BETTER_AUTH_SECRET: 'y'.repeat(40), BETTER_AUTH_URL: 'http://localhost:5198', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }
const auth = makeBetterAuth(env, () => pool, { emailAndPassword: { enabled: true, requireEmailVerification: false } })
const app = createApp({ env, getDb: () => db, auth })
const json = { 'content-type': 'application/json', origin: 'http://localhost:5198' }

test('a real session cookie signs a person in as their invitation, and the tables are mapped correctly', async () => {
  const w = (await pglite.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  const u = (await pglite.query<any>(`insert into core.users (email, display_name) values ('pat@invited.test', 'pat') returning id`)).rows[0].id
  await pglite.query(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, 'editor')`, [w, u])

  // Signed out: refused.
  assert.equal((await app.request('/api/v1/me')).status, 401)

  // Sign up through the library's own route, mounted by our app.
  const up = await app.request('/api/v1/auth/sign-up/email', { method: 'POST', headers: json, body: JSON.stringify({ email: 'pat@invited.test', password: 'a-long-test-password', name: 'Pat Doe' }) })
  assert.equal(up.status, 200, await up.clone().text())
  const cookie = (up.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ')
  assert.match(cookie, /session_token/)

  // The row landed in our snake_case table.
  const row = (await pglite.query<any>(`select id, name, email_verified from public.auth_user where email = 'pat@invited.test'`)).rows[0]
  assert.equal(row.name, 'Pat Doe')
  assert.equal((await pglite.query<any>(`select count(*)::int n from public.auth_session where user_id = $1`, [row.id])).rows[0].n, 1)

  // An unverified email is refused (Google always sends verified ones)...
  const refused = await app.request('/api/v1/me', { headers: { cookie } })
  assert.equal(refused.status, 403)
  assert.equal((await refused.json()).error.code, 'email_unverified')

  // ...and once verified, the cookie is that person, with the invitation's role.
  await pglite.query(`update public.auth_user set email_verified = true where id = $1`, [row.id])
  const me = await (await app.request('/api/v1/me', { headers: { cookie } })).json()
  assert.equal(me.email, 'pat@invited.test')
  assert.equal(me.role, 'editor')
  assert.equal(me.via, 'session')
  assert.equal(me.displayName, 'Pat Doe')

  // Signing out ends it.
  const out = await app.request('/api/v1/auth/sign-out', { method: 'POST', headers: { ...json, cookie }, body: '{}' })
  assert.equal(out.status, 200)
  assert.equal((await app.request('/api/v1/me', { headers: { cookie } })).status, 401)
})

test('the Google sign-in route answers with a redirect to Google', async () => {
  const res = await app.request('/api/v1/auth/sign-in/social', { method: 'POST', headers: json, body: JSON.stringify({ provider: 'google', callbackURL: '/projects' }) })
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.match(body.url, /^https:\/\/accounts\.google\.com\//)
  assert.match(decodeURIComponent(body.url), /redirect_uri=http:\/\/localhost:5198\/api\/v1\/auth\/callback\/google/)
})
