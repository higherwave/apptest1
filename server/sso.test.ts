// The rules that turn a company sign-in into a role: settings, groups claims, and the guard that keeps a workspace's last owner.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { oidcProfileToUser } from './auth.js'
import { claimGroups, googleConfigured, oidcConfigured, roleFromGroups, signInOptions, ssoPolicy } from './sso.js'
import { createDemoDatabase, fakeAuth } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

test('which providers are on, and what the sign-in screen calls them', () => {
  assert.deepEqual(signInOptions({}), [])
  assert.deepEqual(signInOptions({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }), [{ id: 'google', label: 'Google' }])
  const oidc = { OIDC_ISSUER: 'https://acme.okta.com', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b' }
  assert.deepEqual(signInOptions(oidc), [{ id: 'oidc', label: 'single sign-on' }])
  assert.deepEqual(signInOptions({ ...oidc, OIDC_NAME: ' Okta ', GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }), [{ id: 'oidc', label: 'Okta' }, { id: 'google', label: 'Google' }])
  for (const k of Object.keys(oidc)) assert.equal(oidcConfigured({ ...oidc, [k]: '' }), false, k)
  assert.equal(googleConfigured({ GOOGLE_CLIENT_ID: 'a' }), false)
})

test('the policy: groups per role, a default that can never be owner, and when groups are in charge', () => {
  const none = ssoPolicy({})
  assert.equal(none.managedByGroups, false)
  assert.equal(none.defaultRole, null)
  assert.equal(none.groupsClaim, 'groups')
  const p = ssoPolicy({ SSO_OWNER_GROUPS: ' a ,b', SSO_VIEWER_GROUPS: 'v', SSO_DEFAULT_ROLE: 'Editor', OIDC_GROUPS_CLAIM: 'roles' })
  assert.deepEqual(p.groups, { owner: ['a', 'b'], editor: [], viewer: ['v'] })
  assert.equal(p.managedByGroups, true)
  assert.equal(p.defaultRole, 'editor')
  assert.equal(p.groupsClaim, 'roles')
  assert.equal(ssoPolicy({ SSO_DEFAULT_ROLE: 'owner' }).defaultRole, null)
  assert.equal(ssoPolicy({ SSO_DEFAULT_ROLE: 'admin' }).defaultRole, null)
})

test('the highest granted role wins, and names match without regard to case', () => {
  const p = ssoPolicy({ SSO_OWNER_GROUPS: 'Owners', SSO_EDITOR_GROUPS: 'editors', SSO_VIEWER_GROUPS: 'viewers' })
  assert.equal(roleFromGroups(p, ['viewers', 'EDITORS']), 'editor')
  assert.equal(roleFromGroups(p, ['viewers', 'editors', 'owners']), 'owner')
  assert.equal(roleFromGroups(p, ['everyone']), null)
  assert.equal(roleFromGroups(p, []), null)
})

test('groups are read from an array, a single string, or a nested claim; anything else is no groups', () => {
  assert.deepEqual(claimGroups({ groups: ['a', 'b', 3] }, 'groups'), ['a', 'b'])
  assert.deepEqual(claimGroups({ groups: 'solo' }, 'groups'), ['solo'])
  assert.deepEqual(claimGroups({ realm_access: { roles: ['x'] } }, 'realm_access.roles'), ['x'])
  assert.deepEqual(claimGroups({ groups: { not: 'a list' } }, 'groups'), [])
  assert.deepEqual(claimGroups({}, 'groups'), [])
})

test('the account fields taken from the ID token', () => {
  const env = {}
  assert.deepEqual(oidcProfileToUser({ email: 'a@b.test', groups: ['g'] }, env), { name: 'a', emailVerified: true, groups: '["g"]' })
  assert.equal(oidcProfileToUser({ email: 'a@b.test', given_name: 'Ada', family_name: 'L' }, env).name, 'Ada L')
  assert.equal(oidcProfileToUser({ email: 'a@b.test', email_verified: false }, env).emailVerified, false)
  assert.equal(oidcProfileToUser({ email: 'a@b.test', email_verified: 'false' }, env).emailVerified, false)
  assert.equal(oidcProfileToUser({ email: 'a@b.test' }, { OIDC_REQUIRE_VERIFIED_EMAIL: 'true' }).emailVerified, false)
  assert.equal(oidcProfileToUser({ email: 'a@b.test', emailVerified: true }, { OIDC_REQUIRE_VERIFIED_EMAIL: 'true' }).emailVerified, true)
})

test('sign-in groups never leave a workspace without an owner', async () => {
  const { db, pglite } = await createDemoDatabase()
  const env = { BETTER_AUTH_SECRET: 'x'.repeat(32), BETTER_AUTH_URL: 'http://localhost', OIDC_ISSUER: 'https://idp.test', OIDC_CLIENT_ID: 'a', OIDC_CLIENT_SECRET: 'b', SSO_OWNER_GROUPS: 'sf-owners', SSO_EDITOR_GROUPS: 'sf-editors' }
  const app = createApp({ env, getDb: () => db, auth: fakeAuth() })
  const as = (email: string, groups: string[]) => ({ 'x-test-user': JSON.stringify({ id: 'sub-' + email, email, groups }) })
  const owners = () => pglite.query<any>(`select count(*)::int n from core.memberships where role = 'owner'`).then((r) => r.rows[0].n)
  // Demote every owner except the one we sign in as, then try to demote that last one through their groups.
  const first = await app.request('/api/v1/me', { headers: as('first@acme.test', ['sf-owners']) })
  assert.equal((await first.json()).role, 'owner')
  await pglite.query(`update core.memberships set role = 'editor' where role = 'owner' and user_id <> (select id from core.users where email = 'first@acme.test')`)
  assert.equal(await owners(), 1)
  const demoted = await app.request('/api/v1/me', { headers: as('first@acme.test', ['sf-editors']) })
  assert.equal((await demoted.json()).role, 'owner', 'the only owner keeps the role even when their groups say editor')
  assert.equal(await owners(), 1)
})
