// Sign-in and roles: who is let in, as what, and what only owners may do. Uses the stand-in sign-in service (never Google).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PGlite } from '@electric-sql/pglite'
import { createApp } from './app.js'
import { authConfigured, authOptions } from './auth.js'
import type { Db } from './db.js'
import { createDemoDatabase, fakeAuth } from './test-utils.js'
// @ts-expect-error plain ESM tooling shared with db/
import { bootstrapOwners } from '../db/bootstrap-owners.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

let pglite: PGlite
let db: Db
const ready = createDemoDatabase().then((r) => {
  pglite = r.pglite
  db = r.db
})

const SIGNED_IN = { BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: 'http://localhost', GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }
const who = (email: string, id = 'auth-' + email, extra: Record<string, unknown> = {}) => ({ 'x-test-user': JSON.stringify({ id, email, ...extra }) })
const json = { 'content-type': 'application/json' }

async function appFor(env: Record<string, string> = {}, own?: { db: Db }) {
  await ready
  return createApp({ env: { ...SIGNED_IN, ...env }, getDb: () => (own ?? { db }).db, auth: fakeAuth() })
}
// An invitation: the owner's page does this through POST /members; tests may set one up directly.
async function invite(email: string, role: 'owner' | 'editor' | 'viewer', target: PGlite = pglite) {
  await ready
  const w = (await target.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  const u = (await target.query<any>(`insert into core.users (email, display_name) values ($1, $2) on conflict ((lower(email))) do update set email = excluded.email returning id`, [email, email.split('@')[0]])).rows[0].id
  await target.query(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, $3) on conflict (workspace_id, user_id) do update set role = excluded.role`, [w, u, role])
}
const newProject = (name: string) => JSON.stringify({ name, methods: ['User Discussions'], description: null, participants: [{ name: 'Ada', email: 'ada@example.com' }] })

test('authConfigured needs all four settings', () => {
  assert.equal(authConfigured(SIGNED_IN), true)
  for (const k of Object.keys(SIGNED_IN)) assert.equal(authConfigured({ ...SIGNED_IN, [k]: '' }), false, k)
  assert.equal(authConfigured({}), false)
})

test('with sign-in on and editing closed, a request with no session is refused; health stays open', async () => {
  const app = await appFor()
  for (const path of ['/api/v1/me', '/api/v1/projects', '/api/v1/ai/status']) {
    const res = await app.request(path)
    assert.equal(res.status, 401, path)
    assert.equal((await res.json()).error.code, 'unauthenticated')
  }
  assert.equal((await app.request('/api/v1/health')).status, 200)
})

test('an invited person signs in as their own role; the first sign-in links the account and fills in their name', async () => {
  await invite('ola@invited.test', 'editor')
  const app = await appFor()
  const me = await (await app.request('/api/v1/me', { headers: who('ola@invited.test', 'g-ola', { name: 'Ola Nyberg' }) })).json()
  assert.equal(me.role, 'editor')
  assert.equal(me.via, 'session')
  assert.equal(me.displayName, 'Ola Nyberg')
  assert.equal(me.signInAvailable, true)
  const row = (await pglite.query<any>(`select auth_subject, display_name from core.users where lower(email) = 'ola@invited.test'`)).rows[0]
  assert.equal(row.auth_subject, 'g-ola')
  // Next time the account id is enough, whatever case the email comes back in.
  const again = await (await app.request('/api/v1/me', { headers: who('OLA@Invited.test', 'g-ola') })).json()
  assert.equal(again.email, 'ola@invited.test')
})

test('a signed-in person who was not invited gets 403 not_invited; an unverified email is refused', async () => {
  const app = await appFor()
  const res = await app.request('/api/v1/projects', { headers: who('stranger@nowhere.test') })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error.code, 'not_invited')
  await invite('maybe@invited.test', 'viewer')
  const unverified = await app.request('/api/v1/me', { headers: who('maybe@invited.test', 'g-maybe', { verified: false }) })
  assert.equal(unverified.status, 403)
  assert.equal((await unverified.json()).error.code, 'email_unverified')
})

test('an account cannot be taken over by a second account with the same email', async () => {
  await invite('first@invited.test', 'editor')
  const app = await appFor()
  assert.equal((await app.request('/api/v1/me', { headers: who('first@invited.test', 'g-first') })).status, 200)
  // A different account id claiming that email no longer matches: the invitation is already linked.
  assert.equal((await app.request('/api/v1/me', { headers: who('first@invited.test', 'g-impostor') })).status, 403)
})

test('roles: a viewer reads but cannot write; an editor can write but cannot manage members', async () => {
  await invite('vera@invited.test', 'viewer')
  await invite('eddie@invited.test', 'editor')
  const app = await appFor()
  const viewer = who('vera@invited.test')
  const editor = who('eddie@invited.test')
  assert.equal((await app.request('/api/v1/projects', { headers: viewer })).status, 200)
  assert.equal((await app.request('/api/v1/projects', { method: 'POST', headers: { ...viewer, ...json }, body: newProject('By a viewer') })).status, 403)
  assert.equal((await app.request('/api/v1/projects', { method: 'POST', headers: { ...editor, ...json }, body: newProject('By an editor') })).status, 201)
  assert.equal((await app.request('/api/v1/members', { headers: editor })).status, 403, 'the member list is for owners')
  assert.equal((await app.request('/api/v1/members', { headers: viewer })).status, 403)
  const res = await app.request('/api/v1/members', { method: 'POST', headers: { ...editor, ...json }, body: JSON.stringify({ email: 'x@y.test', role: 'viewer' }) })
  assert.equal(res.status, 403)
  assert.equal((await res.json()).error.code, 'forbidden')
})

test('the audit log is for owners: newest first, filterable, paged, and it shows who did what', async () => {
  const own = await createDemoDatabase()
  await invite('audra@invited.test', 'owner', own.pglite)
  await invite('ed@invited.test', 'editor', own.pglite)
  const app = await appFor({}, own)
  const owner = { ...who('audra@invited.test'), ...json }
  const editor = who('ed@invited.test')
  assert.equal((await app.request('/api/v1/audit', { headers: editor })).status, 403, 'an editor cannot read the audit log')
  assert.equal((await app.request('/api/v1/members', { method: 'POST', headers: owner, body: JSON.stringify({ email: 'newbie@invited.test', role: 'viewer' }) })).status, 201)
  assert.equal((await app.request('/api/v1/members', { method: 'POST', headers: owner, body: JSON.stringify({ email: 'newer@invited.test', role: 'viewer' }) })).status, 201)
  const all = await (await app.request('/api/v1/audit', { headers: owner })).json()
  assert.equal(all.data[0].group, 'members')
  assert.equal(all.data[0].actor.name, 'audra')
  assert.equal(all.data[0].after.email, 'newer@invited.test', 'newest first')
  const members = await (await app.request('/api/v1/audit?group=members', { headers: owner })).json()
  assert.ok(members.data.length >= 2 && members.data.every((e: any) => e.group === 'members'))
  const first = await (await app.request('/api/v1/audit?limit=1', { headers: owner })).json()
  assert.equal(first.data.length, 1)
  assert.ok(first.nextCursor)
  const second = await (await app.request(`/api/v1/audit?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`, { headers: owner })).json()
  assert.notEqual(second.data[0].id, first.data[0].id, 'the next page does not repeat the last row')
  assert.equal((await app.request('/api/v1/audit?group=nope', { headers: owner })).status, 422)
  assert.equal((await app.request('/api/v1/audit?cursor=bad', { headers: owner })).status, 422)
})

test('system usage is for owners: the database size against DATABASE_SIZE_LIMIT_MB, with alert levels', async () => {
  const own = await createDemoDatabase()
  await invite('uma@invited.test', 'owner', own.pglite)
  await invite('ed2@invited.test', 'editor', own.pglite)
  const owner = who('uma@invited.test')
  const app = await appFor({}, own)
  assert.equal((await app.request('/api/v1/usage', { headers: who('ed2@invited.test') })).status, 403, 'an editor cannot read it')
  const row = (await (await app.request('/api/v1/usage', { headers: owner })).json()).data[0]
  assert.deepEqual([row.key, row.unit, row.limit], ['database', 'bytes', 1024 * 1024 * 1024])
  assert.ok(Number.isInteger(row.used) && row.used > 0, 'the size is read from the database')
  assert.equal(row.level, 'ok')
  const tight = await appFor({ DATABASE_SIZE_LIMIT_MB: '0.001' }, own)
  assert.equal((await (await tight.request('/api/v1/usage', { headers: owner })).json()).data[0].level, 'reached')
  const none = await appFor({ DATABASE_SIZE_LIMIT_MB: '0' }, own)
  const unlimited = (await (await none.request('/api/v1/usage', { headers: owner })).json()).data[0]
  assert.deepEqual([unlimited.limit, unlimited.level], [null, 'ok'])
})

test('owners invite, change roles and remove; the last owner cannot be demoted or removed', async () => {
  const own = await createDemoDatabase() // this test removes every other owner, so it gets its own database
  await invite('olive@invited.test', 'owner', own.pglite)
  const app = await appFor({}, own)
  const owner = { ...who('olive@invited.test'), ...json }
  const list = async () => (await (await app.request('/api/v1/members', { headers: owner })).json()).data as any[]
  const made = await app.request('/api/v1/members', { method: 'POST', headers: owner, body: JSON.stringify({ email: ' New.Person@Invited.test ', role: 'editor' }) })
  assert.equal(made.status, 201)
  const member = await made.json()
  assert.equal(member.email, 'new.person@invited.test')
  assert.equal(member.status, 'invited')
  assert.equal((await app.request('/api/v1/members', { method: 'POST', headers: owner, body: JSON.stringify({ email: 'new.person@invited.test', role: 'viewer' }) })).status, 409)
  assert.equal((await app.request('/api/v1/members', { method: 'POST', headers: owner, body: JSON.stringify({ email: 'not an email', role: 'viewer' }) })).status, 422)
  const changed = await app.request(`/api/v1/members/${member.id}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ role: 'viewer' }) })
  assert.equal((await changed.json()).role, 'viewer')
  assert.ok((await list()).some((m) => m.email === 'new.person@invited.test' && m.role === 'viewer'))

  // Make every other owner go away, then try to remove or demote the last one.
  for (const m of (await list()).filter((m) => m.role === 'owner' && m.email !== 'olive@invited.test')) {
    assert.equal((await app.request(`/api/v1/members/${m.id}`, { method: 'DELETE', headers: owner })).status, 204)
  }
  const me = (await list()).find((m) => m.email === 'olive@invited.test')
  const demote = await app.request(`/api/v1/members/${me.id}`, { method: 'PATCH', headers: owner, body: JSON.stringify({ role: 'editor' }) })
  assert.equal(demote.status, 409)
  assert.equal((await demote.json()).error.code, 'last_owner')
  assert.equal((await app.request(`/api/v1/members/${me.id}`, { method: 'DELETE', headers: owner })).status, 409)
  assert.equal((await app.request(`/api/v1/members/${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`, { method: 'DELETE', headers: owner })).status, 404)
})

test('removing a member ends their sessions', async () => {
  const own = await createDemoDatabase()
  await invite('boss@invited.test', 'owner', own.pglite)
  await invite('leaver@invited.test', 'editor', own.pglite)
  const app = await appFor({}, own)
  assert.equal((await app.request('/api/v1/me', { headers: who('leaver@invited.test', 'g-leaver') })).status, 200)
  const pglite = own.pglite
  await pglite.query(`insert into public.auth_user (id, name, email, email_verified) values ('g-leaver', 'Leaver', 'leaver@invited.test', true) on conflict do nothing`)
  await pglite.query(`insert into public.auth_session (id, expires_at, token, user_id) values ('s1', now() + interval '1 day', 'tok-leaver', 'g-leaver')`)
  const owner = { ...who('boss@invited.test'), ...json }
  const target = (await (await app.request('/api/v1/members', { headers: owner })).json()).data.find((m: any) => m.email === 'leaver@invited.test')
  assert.equal((await app.request(`/api/v1/members/${target.id}`, { method: 'DELETE', headers: owner })).status, 204)
  assert.equal((await pglite.query<any>(`select count(*)::int n from public.auth_session where user_id = 'g-leaver'`)).rows[0].n, 0)
  assert.equal((await app.request('/api/v1/me', { headers: who('leaver@invited.test', 'g-leaver') })).status, 403)
})

test('the access token still works as a way in while sign-in is on; a wrong one is refused', async () => {
  const app = await appFor({ DEV_TOKEN: 's3cret' })
  const me = await (await app.request('/api/v1/me', { headers: { authorization: 'Bearer s3cret' } })).json()
  assert.equal(me.role, 'owner')
  assert.equal(me.via, 'token')
  assert.equal((await app.request('/api/v1/me', { headers: { authorization: 'Bearer nope' } })).status, 401)
})

test('open editing lets a visitor in as the owner, but a signed-in person still gets their own role', async () => {
  await invite('viv@invited.test', 'viewer')
  const app = await appFor({ OPEN_EDITING: 'true' })
  const visitor = await (await app.request('/api/v1/me')).json()
  assert.equal(visitor.role, 'owner')
  assert.equal(visitor.via, 'open')
  const signedIn = await (await app.request('/api/v1/me', { headers: who('viv@invited.test') })).json()
  assert.equal(signedIn.role, 'viewer')
  assert.equal(signedIn.via, 'session')
})

test('without sign-in configured, nothing changes: the read-only demo viewer and the token', async () => {
  await ready
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db })
  const me = await (await app.request('/api/v1/me')).json()
  assert.equal(me.role, 'viewer')
  assert.equal(me.via, 'anonymous')
  assert.equal(me.signInAvailable, false)
  assert.equal((await app.request('/api/v1/auth/session')).status, 404)
})

test('the sign-in routes are mounted when sign-in is on', async () => {
  const app = await appFor()
  const res = await app.request('/api/v1/auth/sign-in/social', { method: 'POST' })
  assert.equal(res.status, 200)
  assert.equal(await res.text(), 'fake auth')
})

test('bootstrapOwners invites owners who can then sign in, and running it twice changes nothing', async () => {
  const own = await createDemoDatabase()
  const done = await bootstrapOwners(own.pglite, 'higherwave-demo', [' First.Owner@Example.com ', 'second@example.com'])
  assert.deepEqual(done, ['first.owner@example.com', 'second@example.com'])
  await bootstrapOwners(own.pglite, 'higherwave-demo', ['first.owner@example.com'])
  assert.equal((await own.pglite.query<any>(`select count(*)::int n from core.users where lower(email) = 'first.owner@example.com'`)).rows[0].n, 1)
  const app = await appFor({}, own)
  const me = await (await app.request('/api/v1/me', { headers: who('first.owner@example.com', 'g-first-owner') })).json()
  assert.equal(me.role, 'owner')
  // A viewer who is bootstrapped is promoted.
  await invite('promote@example.com', 'viewer', own.pglite)
  await bootstrapOwners(own.pglite, 'higherwave-demo', ['promote@example.com'])
  assert.equal((await (await app.request('/api/v1/me', { headers: who('promote@example.com', 'g-promote') })).json()).role, 'owner')
  await assert.rejects(() => bootstrapOwners(own.pglite, 'no-such-workspace', ['a@b.co']), /No workspace/)
  await assert.rejects(() => bootstrapOwners(own.pglite, 'higherwave-demo', ['not an email']), /not an email/)
})

test('PUBLIC_VIEW lets a visitor look, read-only and uncached; writes, members and sign-in routes stay behind sign-in', async () => {
  await invite('eve@invited.test', 'editor')
  const app = await appFor({ PUBLIC_VIEW: 'true' })
  const me = await (await app.request('/api/v1/me')).json()
  assert.equal(me.role, 'viewer')
  assert.equal(me.via, 'anonymous')
  assert.equal(me.signInAvailable, true)
  const list = await app.request('/api/v1/projects')
  assert.equal(list.status, 200)
  // Sign-in is on, so the CDN must never hold a copy: its cache is not keyed by cookie.
  assert.equal(list.headers.get('cache-control'), 'private, no-store')
  assert.equal((await app.request('/api/v1/projects', { method: 'POST', headers: json, body: newProject('By a visitor') })).status, 401)
  assert.equal((await app.request('/api/v1/members')).status, 401)
  assert.equal((await app.request('/api/v1/health/db')).status, 401)
  // Signing in still gives the person their own role.
  const signedIn = await (await app.request('/api/v1/me', { headers: who('eve@invited.test') })).json()
  assert.equal(signedIn.role, 'editor')
  assert.equal(signedIn.via, 'session')
  // Off (the default here), a visitor is turned away even from reading.
  assert.equal((await (await appFor()).request('/api/v1/projects')).status, 401)
})

test('PUBLIC_VIEW still works when the configured demo identity is not a member of the workspace', async () => {
  // The demo identity is wrong (as on a deployment whose real owners replaced the seeded demo user).
  const app = await appFor({ PUBLIC_VIEW: 'true', DEV_USER_EMAIL: 'nobody@gone.test' })
  const me = await app.request('/api/v1/me')
  assert.equal(me.status, 200)
  const body = await me.json()
  assert.equal(body.role, 'viewer')
  assert.equal(body.via, 'anonymous')
  assert.equal((await app.request('/api/v1/projects')).status, 200)
  // Still read-only.
  assert.equal((await app.request('/api/v1/projects', { method: 'POST', headers: json, body: newProject('By a visitor') })).status, 401)
})

test('BETTER_AUTH_TRUSTED_ORIGINS adds trusted addresses, and the default adds none', () => {
  const pool = {} as never
  assert.deepEqual(authOptions(SIGNED_IN, pool).trustedOrigins, [])
  assert.deepEqual(authOptions({ ...SIGNED_IN, BETTER_AUTH_TRUSTED_ORIGINS: ' https://a.example , https://b.example,' }, pool).trustedOrigins, ['https://a.example', 'https://b.example'])
})

test('finishBuild makes the landing page the root file and the app app.html', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, existsSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  // @ts-expect-error plain ESM build helper
  const { finishBuild } = await import('../scripts/finish-build.mjs')
  const dir = mkdtempSync(join(tmpdir(), 'dist-'))
  writeFileSync(join(dir, 'index.html'), '<div id="root"></div>')
  writeFileSync(join(dir, 'landing.html'), '<h1>Landing</h1>')
  finishBuild(dir)
  assert.equal(readFileSync(join(dir, 'index.html'), 'utf8'), '<h1>Landing</h1>')
  assert.equal(readFileSync(join(dir, 'app.html'), 'utf8'), '<div id="root"></div>')
  assert.ok(existsSync(join(dir, 'landing.html')))
  assert.throws(() => finishBuild(mkdtempSync(join(tmpdir(), 'dist-'))), /Did the build run/)
  // Every address other than the static pages must still reach the app.
  const rewrites = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).rewrites
  assert.equal(rewrites.at(-1).destination, '/app.html')
  const catchAll = new RegExp('^' + rewrites.at(-1).source + '$')
  for (const path of ['/projects', '/sign-in', '/members', '/projects/abc/themes']) assert.ok(catchAll.test(path), path)
  for (const path of ['/landing.html', '/landing-icon.png', '/landing-motion.js', '/privacy.html', '/about.html', '/logo.png', '/favicon.ico', '/robots.txt', '/assets/index-abc.js', '/app.html']) assert.ok(!catchAll.test(path), path)
})

test('the sign-in picture is reported by /me, and a changed one is picked up at the next sign-in', async () => {
  await invite('pia@invited.test', 'viewer')
  const app = await appFor()
  const meOf = async (image?: string) => (await app.request('/api/v1/me', { headers: who('pia@invited.test', 'g-pia', { name: 'Pia', image }) })).json()
  assert.equal((await meOf('https://photos.example/pia-1.jpg')).avatarUrl, 'https://photos.example/pia-1.jpg')
  assert.equal((await meOf('https://photos.example/pia-2.jpg')).avatarUrl, 'https://photos.example/pia-2.jpg')
  assert.equal((await meOf()).avatarUrl, 'https://photos.example/pia-2.jpg', 'no picture from the provider keeps the last one')
  const { rows } = await pglite.query<any>(`select avatar_url from core.users where lower(email) = 'pia@invited.test'`)
  assert.equal(rows[0].avatar_url, 'https://photos.example/pia-2.jpg')
  const token = await appFor({ DEV_TOKEN: 'sesame' })
  assert.equal((await (await token.request('/api/v1/me', { headers: { authorization: 'Bearer sesame' } })).json()).avatarUrl, null)
})

test('AI status: everyone sees the mode; only an owner sees what went wrong with it', async () => {
  await invite('olga@invited.test', 'owner')
  await invite('edna@invited.test', 'editor')
  const app = await appFor()
  const ws = (await pglite.query<any>(`select id from core.workspaces where slug = 'higherwave-demo'`)).rows[0].id
  await pglite.query(`insert into core.ai_problems (workspace_id, purpose, code, message) values ($1, 'analysis', 'ai_output_unusable', 'The reply could not be used.')`, [ws])
  const status = async (email: string) => (await app.request('/api/v1/ai/status', { headers: who(email) })).json()
  const owner = await status('olga@invited.test')
  assert.equal(owner.problems?.[0]?.code, 'ai_output_unusable', 'an owner sees the problems')
  const editor = await status('edna@invited.test')
  assert.ok(['live', 'simulated'].includes(editor.mode), 'an editor still sees the mode')
  assert.ok(!('problems' in editor) && !('spentUsd' in editor) && !('budgetUsd' in editor), 'but not the problems or the spend')
})
