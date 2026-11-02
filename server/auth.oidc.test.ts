// The company sign-in end to end: the real Better Auth library and our request context, against a stand-in OpenID Connect
// provider (discovery, signing keys, authorize and token endpoints) on a local port, and an in-memory Postgres behind a socket.
// What this proves: the ID token is verified (signature, audience, nonce), the groups reach the role, and the closed-by-default
// rules hold. No real Okta or Entra tenant is involved.
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
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

const APP = 'http://localhost:5198'
const CLIENT_ID = 'signalflow-test'
const CLIENT_SECRET = 'client-secret'

// --- the stand-in identity provider ---------------------------------------------------------------------------------------
type Claims = Record<string, unknown>
const keys = await generateKeyPair('RS256')
const otherKeys = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const idp = { next: { sub: 'u-1', email: 'x@y.test' } as Claims, signWith: keys.privateKey as CryptoKey | undefined, audience: CLIENT_ID, issuer: '' }
const codes = new Map<string, { nonce: string; claims: Claims }>()

const idpServer: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', idp.issuer)
  const send = (status: number, body: unknown) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
  if (url.pathname === '/.well-known/openid-configuration') {
    return send(200, {
      issuer: idp.issuer, authorization_endpoint: `${idp.issuer}/authorize`, token_endpoint: `${idp.issuer}/token`, jwks_uri: `${idp.issuer}/jwks`,
      id_token_signing_alg_values_supported: ['RS256'], response_types_supported: ['code'], subject_types_supported: ['public'],
    })
  }
  if (url.pathname === '/jwks') return send(200, { keys: [jwk] })
  if (url.pathname === '/authorize') {
    assert.equal(url.searchParams.get('client_id'), CLIENT_ID)
    assert.ok(url.searchParams.get('code_challenge'), 'PKCE is used')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    const code = randomUUID()
    codes.set(code, { nonce: url.searchParams.get('nonce') ?? '', claims: idp.next })
    const back = new URL(url.searchParams.get('redirect_uri')!)
    back.searchParams.set('code', code)
    back.searchParams.set('state', url.searchParams.get('state')!)
    res.writeHead(302, { location: back.toString() })
    return res.end()
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const form = new URLSearchParams(raw)
    const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')
    const secret = basic ? Buffer.from(basic[1], 'base64').toString().split(':')[1] : form.get('client_secret')
    const entry = codes.get(form.get('code') ?? '')
    if (!entry || decodeURIComponent(secret ?? '') !== CLIENT_SECRET || !form.get('code_verifier')) return send(400, { error: 'invalid_grant' })
    codes.delete(form.get('code')!)
    const now = Math.floor(Date.now() / 1000)
    const idToken = await new SignJWT({ ...entry.claims, nonce: entry.nonce })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(idp.issuer).setAudience(idp.audience).setIssuedAt(now).setExpirationTime(now + 300)
      .sign(idp.signWith ?? keys.privateKey)
    return send(200, { access_token: 'at-' + randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: idToken, scope: 'openid email profile' })
  }
  send(404, { error: 'not_found' })
})
await new Promise<void>((r) => idpServer.listen(0, '127.0.0.1', r))
idp.issuer = `http://127.0.0.1:${(idpServer.address() as { port: number }).port}`

// --- the database and the app -----------------------------------------------------------------------------------------------
const { pglite, db } = await createDemoDatabase()
const dbServer = new PGLiteSocketServer({ db: pglite, port: 0, host: '127.0.0.1' })
await dbServer.start()
const address = (dbServer as any).server?.address?.() ?? (dbServer as any).getAddress?.()
const port = typeof address === 'object' && address ? address.port : Number(process.env.PGLITE_PORT)
const pool = new pg.Pool({ host: '127.0.0.1', port, user: 'postgres', database: 'postgres', max: 2 })
after(async () => {
  await pool.end()
  await dbServer.stop()
  idpServer.close()
})

const baseEnv = () => ({
  BETTER_AUTH_SECRET: 'z'.repeat(40), BETTER_AUTH_URL: APP, OIDC_ISSUER: idp.issuer, OIDC_CLIENT_ID: CLIENT_ID, OIDC_CLIENT_SECRET: CLIENT_SECRET, OIDC_NAME: 'Acme SSO',
})
const appWith = (extra: Record<string, string> = {}) => {
  const env = { ...baseEnv(), ...extra }
  return createApp({ env, getDb: () => db, auth: makeBetterAuth(env, () => pool) })
}
const cookiesOf = (res: Response) => (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0])
const jar = (...lists: string[][]) => [...new Map(lists.flat().map((c) => [c.split('=')[0], c])).values()].join('; ')

/** The whole browser trip: start sign-in, the provider's authorize step, the callback. Resolves with the session cookie, if any. */
async function signIn(app: ReturnType<typeof appWith>, claims: Claims): Promise<{ cookie: string; callback: Response }> {
  idp.next = claims
  const start = await app.request('/api/v1/auth/sign-in/social', { method: 'POST', headers: { 'content-type': 'application/json', origin: APP }, body: JSON.stringify({ provider: 'oidc', callbackURL: '/projects' }) })
  assert.equal(start.status, 200, await start.clone().text())
  const { url } = await start.json()
  assert.ok(url.startsWith(idp.issuer + '/authorize'), url)
  const authorize = await fetch(url, { redirect: 'manual' })
  assert.equal(authorize.status, 302)
  const back = new URL(authorize.headers.get('location')!)
  assert.equal(back.origin + back.pathname, `${APP}/api/v1/auth/callback/oidc`)
  const callback = await app.request(back.pathname + back.search, { headers: { cookie: jar(cookiesOf(start)) } })
  return { cookie: jar(cookiesOf(start), cookiesOf(callback)), callback }
}
const me = (app: ReturnType<typeof appWith>, cookie: string) => app.request('/api/v1/me', { headers: { cookie } })
const invite = async (email: string, role: string) => {
  const w = (await pglite.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  const u = (await pglite.query<any>(`insert into core.users (email, display_name) values ($1, $2) returning id`, [email, email.split('@')[0]])).rows[0].id
  await pglite.query(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, $3)`, [w, u, role])
}

test('the sign-in screen is told about the company provider, and its callback address is the one to register', async () => {
  const app = appWith()
  const options = await (await app.request('/api/v1/sign-in-options')).json()
  assert.deepEqual(options, { data: [{ id: 'oidc', label: 'Acme SSO' }] })
  const start = await app.request('/api/v1/auth/sign-in/social', { method: 'POST', headers: { 'content-type': 'application/json', origin: APP }, body: JSON.stringify({ provider: 'oidc', callbackURL: '/' }) })
  assert.match(decodeURIComponent((await start.json()).url), /redirect_uri=http:\/\/localhost:5198\/api\/v1\/auth\/callback\/oidc/)
})

test('an invited person signs in through the provider and gets their invited role; the provider need not send email_verified', async () => {
  await invite('ada@acme.test', 'editor')
  const app = appWith()
  assert.equal((await app.request('/api/v1/me')).status, 401)
  const { cookie } = await signIn(app, { sub: 'okta-ada', email: 'ada@acme.test', name: 'Ada Lovelace' })
  assert.match(cookie, /session_token/)
  const body = await (await me(app, cookie)).json()
  assert.equal(body.email, 'ada@acme.test')
  assert.equal(body.role, 'editor')
  assert.equal(body.via, 'session')
  assert.equal(body.displayName, 'Ada Lovelace')
  assert.equal(body.rolesManagedBySso, false)
})

test('a person the provider knows but nobody invited is refused, unless SSO_DEFAULT_ROLE adds them', async () => {
  const closed = appWith()
  const first = await signIn(closed, { sub: 'okta-bo', email: 'bo@acme.test', name: 'Bo' })
  const refused = await me(closed, first.cookie)
  assert.equal(refused.status, 403)
  assert.equal((await refused.json()).error.code, 'not_invited')

  const open = appWith({ SSO_DEFAULT_ROLE: 'viewer' })
  const added = await me(open, first.cookie)
  assert.equal(added.status, 200)
  assert.equal((await added.json()).role, 'viewer')
  const audit = (await pglite.query<any>(`select verb, after from core.audit_log where verb = 'added by sign-in'`)).rows
  assert.equal(audit.length, 1)
  assert.equal(JSON.parse(typeof audit[0].after === 'string' ? audit[0].after : JSON.stringify(audit[0].after)).email, 'bo@acme.test')
})

test('an email the provider marks unverified is refused; OIDC_REQUIRE_VERIFIED_EMAIL also refuses one that says nothing', async () => {
  await invite('cy@acme.test', 'editor')
  const app = appWith()
  const unverified = await signIn(app, { sub: 'okta-cy', email: 'cy@acme.test', email_verified: false })
  const res = await me(app, unverified.cookie)
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error.code, 'email_unverified')

  await invite('di@acme.test', 'editor')
  const strict = appWith({ OIDC_REQUIRE_VERIFIED_EMAIL: 'true' })
  const silent = await signIn(strict, { sub: 'okta-di', email: 'di@acme.test' })
  assert.equal((await me(strict, silent.cookie)).status, 403)
  const said = await signIn(strict, { sub: 'okta-di', email: 'di@acme.test', email_verified: true })
  assert.equal((await me(strict, said.cookie)).status, 200)
})

test('groups decide the role at every sign-in, and a person in no group is refused', async () => {
  const app = appWith({ SSO_OWNER_GROUPS: 'sf-owners', SSO_EDITOR_GROUPS: 'sf-editors, sf-staff', SSO_VIEWER_GROUPS: 'sf-viewers' })
  const first = await signIn(app, { sub: 'okta-eve', email: 'eve@acme.test', name: 'Eve', groups: ['everyone', 'SF-Editors'] })
  const asEditor = await (await me(app, first.cookie)).json()
  assert.equal(asEditor.role, 'editor')
  assert.equal(asEditor.rolesManagedBySso, true)

  // Promoted in the provider: the next sign-in carries the new group, and the role follows.
  const second = await signIn(app, { sub: 'okta-eve', email: 'eve@acme.test', name: 'Eve', groups: ['sf-viewers', 'sf-owners'] })
  assert.equal((await (await me(app, second.cookie)).json()).role, 'owner')
  const verbs = (await pglite.query<any>(`select verb from core.audit_log where entity_id in (select m.id from core.memberships m join core.users u on u.id = m.user_id where u.email = 'eve@acme.test') order by created_at`)).rows.map((r) => r.verb)
  assert.deepEqual(verbs, ['added by sign-in', 'role set by sign-in groups'])

  // Taken out of every group: refused (the only-owner guard is covered in sso.test.ts; Eve is not the only owner here).
  await invite('owner@acme.test', 'owner')
  const third = await signIn(app, { sub: 'okta-eve', email: 'eve@acme.test', name: 'Eve', groups: ['everyone'] })
  const gone = await me(app, third.cookie)
  assert.equal(gone.status, 403)
  assert.equal((await gone.json()).error.code, 'not_in_group')

  // With groups in charge, the Members page cannot hand out roles.
  const owner = await signIn(app, { sub: 'okta-eve', email: 'eve@acme.test', groups: ['sf-owners'] })
  const invitation = await app.request('/api/v1/members', { method: 'POST', headers: { 'content-type': 'application/json', cookie: owner.cookie }, body: JSON.stringify({ email: 'new@acme.test', role: 'viewer' }) })
  assert.equal(invitation.status, 409)
  assert.equal((await invitation.json()).error.code, 'managed_by_sso')
})

test('a nested groups claim can be read (OIDC_GROUPS_CLAIM)', async () => {
  const app = appWith({ SSO_EDITOR_GROUPS: 'kc-editor', OIDC_GROUPS_CLAIM: 'realm_access.roles' })
  const s = await signIn(app, { sub: 'kc-fay', email: 'fay@acme.test', realm_access: { roles: ['kc-editor'] } })
  assert.equal((await (await me(app, s.cookie)).json()).role, 'editor')
})

test('an ID token signed with a different key, or for a different client, never makes a session', async () => {
  await invite('gus@acme.test', 'owner')
  const app = appWith()
  idp.signWith = otherKeys.privateKey
  const forged = await signIn(app, { sub: 'okta-gus', email: 'gus@acme.test' })
  idp.signWith = undefined
  assert.doesNotMatch(forged.cookie, /session_token/)
  assert.equal((await me(app, forged.cookie)).status, 401)

  idp.audience = 'someone-else'
  const wrongAudience = await signIn(app, { sub: 'okta-gus', email: 'gus@acme.test' })
  idp.audience = CLIENT_ID
  assert.doesNotMatch(wrongAudience.cookie, /session_token/)
  assert.equal((await me(app, wrongAudience.cookie)).status, 401)

  // And the genuine one still works.
  const genuine = await signIn(app, { sub: 'okta-gus', email: 'gus@acme.test' })
  assert.equal((await me(app, genuine.cookie)).status, 200)
})
