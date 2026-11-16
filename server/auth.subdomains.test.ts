// Sign-in across customer addresses, end to end with the real Better Auth library and a stand-in OpenID Connect provider: a person starts on
// <customer>.<domain>, signs in through the one fixed sign-in address, and comes back to where they started, with one session that every
// customer address can see. Cookies are kept the way a browser keeps them (by domain), so this passes only if they really are shared.
// What this proves: the return address is checked, an origin from anywhere else is refused, and being signed in never lets a person into a
// workspace they do not belong to. Run with: npm run test:api
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
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const LOGIN = 'https://app.signalflow.example'
const ACME = 'https://acme.signalflow.example'
const BETA = 'https://beta.signalflow.example'
const CLIENT_ID = 'signalflow-test'
const CLIENT_SECRET = 'client-secret'

// --- the stand-in identity provider (the same shape as auth.oidc.test.ts) ----------------------------------------------------
const keys = await generateKeyPair('RS256')
const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' }
const idp = { next: { sub: 'u-1', email: 'x@y.test' } as Record<string, unknown>, issuer: '' }
const codes = new Map<string, { nonce: string; claims: Record<string, unknown> }>()
const idpServer: Server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', idp.issuer)
  const send = (status: number, body: unknown) => (res.writeHead(status, { 'content-type': 'application/json' }), res.end(JSON.stringify(body)))
  if (url.pathname === '/.well-known/openid-configuration') {
    return send(200, { issuer: idp.issuer, authorization_endpoint: `${idp.issuer}/authorize`, token_endpoint: `${idp.issuer}/token`, jwks_uri: `${idp.issuer}/jwks`, id_token_signing_alg_values_supported: ['RS256'], response_types_supported: ['code'], subject_types_supported: ['public'] })
  }
  if (url.pathname === '/jwks') return send(200, { keys: [jwk] })
  if (url.pathname === '/authorize') {
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
    const entry = codes.get(form.get('code') ?? '')
    if (!entry || !form.get('code_verifier')) return send(400, { error: 'invalid_grant' })
    codes.delete(form.get('code')!)
    const now = Math.floor(Date.now() / 1000)
    const idToken = await new SignJWT({ ...entry.claims, nonce: entry.nonce }).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(idp.issuer).setAudience(CLIENT_ID).setIssuedAt(now).setExpirationTime(now + 300).sign(keys.privateKey)
    return send(200, { access_token: 'at-' + randomUUID(), token_type: 'Bearer', expires_in: 300, id_token: idToken, scope: 'openid email profile' })
  }
  send(404, { error: 'not_found' })
})
await new Promise<void>((r) => idpServer.listen(0, '127.0.0.1', r))
idp.issuer = `http://127.0.0.1:${(idpServer.address() as { port: number }).port}`

// --- two customers' workspaces, and the app ---------------------------------------------------------------------------------
const { pglite, db } = await createDemoDatabase()
await initWorkspace(pglite, { name: 'Acme', slug: 'acme', owners: ['ada@acme.test'] })
await initWorkspace(pglite, { name: 'Beta', slug: 'beta', owners: ['bo@beta.test'] })
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

const env = (extra: Record<string, string> = {}) => ({
  BETTER_AUTH_SECRET: 'z'.repeat(40), BETTER_AUTH_URL: LOGIN, WORKSPACE_BASE_DOMAIN: 'signalflow.example', OIDC_ISSUER: idp.issuer, OIDC_CLIENT_ID: CLIENT_ID, OIDC_CLIENT_SECRET: CLIENT_SECRET, OIDC_NAME: 'SSO', ...extra,
})
const appWith = (extra: Record<string, string> = {}) => {
  const e = env(extra)
  return createApp({ env: e, getDb: () => db, auth: makeBetterAuth(e, () => pool) })
}

// A browser's cookie jar: a cookie with a Domain is sent to that domain and its subdomains; one without is sent only to the address that set it.
class Browser {
  cookies: { name: string; value: string; domain: string | null; host: string; secure: boolean }[] = []
  constructor(public app: ReturnType<typeof appWith>, private ignoreDomain = false) {}
  async fetch(url: string, init: RequestInit & { headers?: Record<string, string> } = {}): Promise<Response> {
    const u = new URL(url)
    const sent = this.cookies.filter((c) => (c.domain ? u.hostname === c.domain || u.hostname.endsWith(`.${c.domain}`) : u.hostname === c.host)).map((c) => `${c.name}=${c.value}`)
    const res = await this.app.request(url, { ...init, headers: { ...(init.headers ?? {}), ...(sent.length ? { cookie: sent.join('; ') } : {}) } })
    for (const line of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = line.split(';').map((p) => p.trim())
      const [name, ...v] = pair.split('=')
      const domain = this.ignoreDomain ? null : attrs.find((a) => /^domain=/i.test(a))?.split('=')[1]?.replace(/^\./, '').toLowerCase() ?? null
      const maxAge = attrs.find((a) => /^max-age=/i.test(a))?.split('=')[1]
      this.cookies = this.cookies.filter((c) => !(c.name === name && c.domain === domain && c.host === u.hostname))
      if (maxAge !== '0') this.cookies.push({ name, value: v.join('='), domain, host: u.hostname, secure: attrs.some((a) => /^secure$/i.test(a)) })
    }
    return res
  }
  setCookieLines = async (url: string, init: RequestInit & { headers?: Record<string, string> }) => (await this.app.request(url, init)).headers.getSetCookie?.() ?? []

  /** Start on `from`, go through the provider, come back. Resolves with where the browser ends up. */
  async signIn(from: string, claims: Record<string, unknown>, callbackURL = `${from}/projects`) {
    idp.next = claims
    const start = await this.fetch(`${from}/api/v1/auth/sign-in/social`, { method: 'POST', headers: { 'content-type': 'application/json', origin: from }, body: JSON.stringify({ provider: 'oidc', callbackURL }) })
    assert.equal(start.status, 200, await start.clone().text())
    const { url } = await start.json()
    const authorize = await fetch(url, { redirect: 'manual' })
    const back = new URL(authorize.headers.get('location')!)
    assert.equal(back.origin, LOGIN, 'the provider sends the person to the one fixed sign-in address')
    const callback = await this.fetch(back.toString())
    return { start, providerUrl: url as string, callback, landed: callback.headers.get('location') }
  }
}
const me = (b: Browser, host: string) => b.fetch(`${host}/api/v1/me`)

test('a person starts on their customer address, signs in at the fixed address, and comes back to where they started', async () => {
  const b = new Browser(appWith())
  const { providerUrl, callback, landed } = await b.signIn(ACME, { sub: 'okta-ada', email: 'ada@acme.test', name: 'Ada' })
  assert.match(decodeURIComponent(providerUrl), new RegExp(`redirect_uri=${LOGIN.replace(/[.]/g, '\\.')}/api/v1/auth/callback/oidc`), 'the address registered with the provider is the fixed one')
  assert.equal(landed, `${ACME}/projects`, 'back on the customer address they came from')
  const cookie = callback.headers.getSetCookie().find((c) => /session_token/.test(c))!
  assert.match(cookie, /domain=\.?signalflow\.example/i, 'the session belongs to the parent domain')
  assert.match(cookie, /secure/i)
  assert.match(cookie, /httponly/i)
  assert.match(cookie, /samesite=lax/i)
  const mine = await me(b, ACME)
  assert.equal(mine.status, 200, JSON.stringify(await mine.clone().json()))
  const body = await mine.json()
  assert.equal(body.email, 'ada@acme.test')
  assert.equal(body.workspaceName, 'Acme')
  assert.equal(body.role, 'owner')
})

test('being signed in is not being let in: the same session is refused at a customer address the person does not belong to', async () => {
  const b = new Browser(appWith())
  await b.signIn(ACME, { sub: 'okta-ada2', email: 'ada@acme.test', name: 'Ada' })
  assert.equal((await me(b, ACME)).status, 200)
  const refused = await me(b, BETA)
  assert.equal(refused.status, 403)
  assert.equal((await refused.json()).error.code, 'not_invited')
  // And the other way round: Bo is at home at Beta and a stranger at Acme, with one sign-in.
  const bo = new Browser(appWith())
  await bo.signIn(BETA, { sub: 'okta-bo', email: 'bo@beta.test', name: 'Bo' })
  assert.equal((await me(bo, BETA)).status, 200)
  assert.equal((await me(bo, ACME)).status, 403)
})

test('one person in two workspaces signs in once and uses both', async () => {
  const w = (await pglite.query<any>(`select id from core.workspaces where slug = 'beta'`)).rows[0].id
  const u = (await pglite.query<any>(`select id from core.users where email = 'ada@acme.test'`)).rows[0].id
  await pglite.query(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, 'viewer')`, [w, u])
  const b = new Browser(appWith())
  await b.signIn(ACME, { sub: 'okta-ada3', email: 'ada@acme.test', name: 'Ada' })
  const here = await (await me(b, ACME)).json()
  const there = await (await me(b, BETA)).json()
  assert.deepEqual([here.workspaceName, here.role, there.workspaceName, there.role], ['Acme', 'owner', 'Beta', 'viewer'])
})

test('control: the same trip fails when the browser is not sharing cookies across the addresses, so the passing test above depends on the shared domain', async () => {
  const b = new Browser(appWith(), true) // keeps every cookie to the address that set it
  idp.next = { sub: 'okta-ctl', email: 'ada@acme.test', name: 'Ada' }
  const start = await b.fetch(`${ACME}/api/v1/auth/sign-in/social`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ACME }, body: JSON.stringify({ provider: 'oidc', callbackURL: `${ACME}/projects` }) })
  assert.equal(start.status, 200)
  const { url } = await start.json()
  const back = new URL((await fetch(url, { redirect: 'manual' })).headers.get('location')!)
  const callback = await b.fetch(back.toString())
  assert.ok(!callback.headers.getSetCookie().some((c) => /session_token/.test(c)), 'no session is made when the sign-in state cookie did not arrive')
  assert.equal((await me(b, ACME)).status, 401)
})

test('the way back must be a customer address under our domain: anything else is refused before the provider is even visited', async () => {
  const b = new Browser(appWith())
  const start = (callbackURL: string, origin = ACME) =>
    b.fetch(`${ACME}/api/v1/auth/sign-in/social`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ provider: 'oidc', callbackURL }) })
  assert.equal((await start(`${ACME}/projects`)).status, 200)
  assert.equal((await start(`${BETA}/projects`)).status, 200, 'another customer address is still ours')
  for (const bad of ['https://evil.example/steal', 'https://signalflow.example.evil.test/x', 'https://evilsignalflow.example/x', 'http://acme.signalflow.example/x', '//evil.example/x', 'javascript:alert(1)']) {
    const res = await start(bad)
    assert.notEqual(res.status, 200, `${bad} must be refused`)
  }
})

test('a request that comes from another site, or one that only looks like ours, is refused', async () => {
  const b = new Browser(appWith())
  const from = (origin: string) =>
    b.fetch(`${ACME}/api/v1/auth/sign-in/social`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ provider: 'oidc', callbackURL: `${ACME}/` }) })
  assert.equal((await from('https://acme.signalflow.example')).status, 200)
  for (const origin of ['https://evil.example', 'https://acme.signalflow.example.evil.test', 'https://evilsignalflow.example', 'http://acme.signalflow.example']) {
    assert.equal((await from(origin)).status, 403, origin)
  }
})

test('signing out on one customer address ends the session on all of them', async () => {
  const b = new Browser(appWith())
  await b.signIn(ACME, { sub: 'okta-ada4', email: 'ada@acme.test', name: 'Ada' })
  assert.equal((await me(b, ACME)).status, 200)
  const out = await b.fetch(`${ACME}/api/v1/auth/sign-out`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ACME }, body: '{}' })
  assert.equal(out.status, 200)
  assert.equal((await me(b, ACME)).status, 401)
  assert.equal((await me(b, BETA)).status, 401)
})

test('the demo’s public viewing and open editing belong to the home workspace only: a customer’s workspace never opens to someone who has not signed in', async () => {
  const b = new Browser(appWith({ PUBLIC_VIEW: 'true', OPEN_EDITING: 'false', WORKSPACE_SLUG: 'higherwave-demo' }))
  assert.equal((await b.fetch(`${LOGIN}/api/v1/projects`)).status, 200, 'the home workspace may be viewed by anyone, as the demo is')
  for (const host of [ACME, BETA]) {
    const res = await b.fetch(`${host}/api/v1/projects`)
    assert.equal(res.status, 401, `${host} must ask for sign-in`)
    assert.equal((await res.json()).error.code, 'unauthenticated')
    assert.equal((await b.fetch(`${host}/api/v1/me`)).status, 401)
  }
  // Open editing (no sign-in at all) is the same: home only.
  const open = new Browser(appWith({ PUBLIC_VIEW: 'true', OPEN_EDITING: 'true', WORKSPACE_SLUG: 'higherwave-demo' }))
  assert.equal((await open.fetch(`${LOGIN}/api/v1/me`)).status, 200)
  assert.equal((await open.fetch(`${ACME}/api/v1/me`)).status, 401, 'open editing must not reach a customer’s workspace')
  const write = await open.fetch(`${ACME}/api/v1/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(write.status, 401)
})
