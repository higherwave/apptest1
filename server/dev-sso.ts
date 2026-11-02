// Try a real identity provider (Okta, Entra ID, Keycloak, ...) on this machine, against a throwaway in-memory copy of the demo data.
//   npm run sso:try        (reads db/.env.sso.local; see docs/SSO-TRY.md)
// It runs the real sign-in library (Better Auth over a local Postgres socket), so the whole trip is exercised: the redirect to the
// provider, its callback, the ID token check, the groups, and the role. Nothing touches Neon or production. It prints one line for
// every sign-in so you can see what role the provider's answer turned into.
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import pg from 'pg'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { randomBytes } from 'node:crypto'
import { createApp } from './app.js'
import { makeBetterAuth } from './auth.js'
import { oidcConfigured, signInOptions, ssoPolicy } from './sso.js'
import { createDemoDatabase } from './test-utils.js'

const env: Record<string, string | undefined> = { ...process.env }
const missing = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'].filter((k) => !env[k])
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}. Put them in db/.env.sso.local (see docs/SSO-TRY.md) and run: npm run sso:try`)
  process.exit(1)
}

const appPort = Number(env.SSO_TRY_APP_PORT || 5198)
const apiPort = Number(env.SSO_TRY_API_PORT || 8793)
env.BETTER_AUTH_URL ||= `http://localhost:${appPort}`
env.BETTER_AUTH_SECRET ||= randomBytes(32).toString('base64')
env.OPEN_EDITING = 'false'
env.PUBLIC_VIEW = 'false'
env.WORKSPACE_SLUG = 'higherwave-demo'
env.DESIGN_CAPTURE = 'false'

const { pglite, db } = await createDemoDatabase()
const socket = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1' })
await socket.start()
const address = (socket as any).server?.address?.() ?? (socket as any).getAddress?.()
const pool = new pg.Pool({ host: '127.0.0.1', port: typeof address === 'object' && address ? address.port : Number(process.env.PGLITE_PORT), user: 'postgres', database: 'postgres', max: 2 })

// The first owner, when the groups do not make one: SSO_TRY_OWNER_EMAIL is invited as an owner of the demo workspace.
const owner = env.SSO_TRY_OWNER_EMAIL?.trim().toLowerCase()
if (owner) {
  const w = (await pglite.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  const u = (await pglite.query<any>(`insert into core.users (email, display_name) values ($1, $2) returning id`, [owner, owner.split('@')[0]])).rows[0].id
  await pglite.query(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, 'owner')`, [w, u])
}

const app = createApp({ env, getDb: () => db, auth: makeBetterAuth(env, () => pool), capture: null })
const root = new Hono()
// One line per sign-in attempt, taken from the answers the app gives (never from its internals).
root.use('/api/v1/*', async (c, next) => {
  await next()
  const path = new URL(c.req.url).pathname
  if (path.endsWith('/me') && c.req.header('cookie')?.includes('session_token')) {
    const body = await c.res.clone().json().catch(() => ({}))
    if (c.res.status === 200) console.log(`  signed in: ${body.email} as ${body.role} (${body.rolesManagedBySso ? 'role from your groups' : 'role from an invitation or the default role'})`)
    else console.log(`  refused (${c.res.status}): ${body?.error?.code ?? 'unknown'} - ${body?.error?.message ?? ''}`)
  }
  if (path.includes('/auth/callback/') && c.res.status >= 400) console.log(`  the provider's callback failed (${c.res.status}); the server log above has the reason`)
})
root.route('/', app)
serve({ fetch: root.fetch, port: apiPort }, () => {
  const policy = ssoPolicy(env)
  console.log(`Sign-in test API on http://localhost:${apiPort} (throwaway data; nothing is saved)`)
  console.log(`  provider: ${oidcConfigured(env) ? signInOptions(env).map((o) => o.label).join(', ') : 'none'}, issuer ${env.OIDC_ISSUER}`)
  console.log(`  roles: ${policy.managedByGroups ? 'from groups' : 'from invitations'}${owner ? `, ${owner} is invited as owner` : ''}${policy.defaultRoleFor('someone@example.com') ? `, others join as ${policy.defaultRoleFor('someone@example.com')}` : ''}`)
})
