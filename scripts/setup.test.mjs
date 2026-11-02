// Standing up a new environment: bootstrap builds the database and the workspace, and doctor says what is still missing.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { bootstrap } from './bootstrap.mjs'
import { diagnoseDatabase, diagnoseSettings } from './doctor.mjs'

// The same two calls a pg client has; a statement with no parameters runs through exec so a whole migration file works.
const adapt = (pg) => {
  const calls = []
  return {
    calls,
    query: async (sql, params) => {
      calls.push(sql)
      if (params?.length) return pg.query(sql, params)
      const r = await pg.exec(sql)
      return { rows: r.at(-1)?.rows ?? [] }
    },
  }
}
const quiet = () => {}
const levels = (rs) => Object.fromEntries(rs.map((r) => [r.area, r.level]))
const READY = { DATABASE_URL: 'postgres://u:p@h/db', WORKSPACE_SLUG: 'acme', OPEN_EDITING: 'false', PUBLIC_VIEW: 'false', BETTER_AUTH_URL: 'https://app.acme.com', BETTER_AUTH_SECRET: 'x'.repeat(40), GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }

test('doctor passes a complete environment, and says what to do about each gap in an incomplete one', () => {
  const good = diagnoseSettings(READY)
  assert.ok(good.every((r) => r.level !== 'fail'), JSON.stringify(good.filter((r) => r.level === 'fail')))
  assert.equal(levels(good).Database, 'ok')

  const empty = diagnoseSettings({})
  assert.equal(levels(empty).Database, 'fail')
  assert.match(empty.find((r) => r.area === 'Database').fix, /DATABASE_URL_UNPOOLED/)
  assert.equal(levels(empty)['Sign-in'], 'warn', 'no sign-in at all is a warning: a demo can run without it')
  assert.equal(levels(empty).Workspace, 'warn')
  assert.equal(levels(empty).AI, 'warn')
})

test('doctor catches half-set pairs, a short secret, and demo settings left on', () => {
  const half = levels(diagnoseSettings({ ...READY, GOOGLE_CLIENT_SECRET: undefined, ANTHROPIC_API_KEY: 'k' }))
  assert.equal(half['Sign-in'], 'fail')
  assert.equal(half.AI, 'fail', 'a key without a provider (or the reverse) is half a setting')
  assert.equal(levels(diagnoseSettings({ ...READY, BETTER_AUTH_SECRET: 'short' }))['Sign-in'], 'fail')
  const open = diagnoseSettings({ ...READY, OPEN_EDITING: 'true', PUBLIC_VIEW: 'true' })
  assert.equal(open.filter((r) => r.area === 'Access' && r.level === 'warn').length, 2, 'open editing and public view on a company workspace')
  assert.ok(diagnoseSettings({ ...READY, VERCEL_ENV: 'production', DEV_TOKEN: 't' }).some((r) => r.area === 'Access' && /DEV_TOKEN/.test(r.message)))
  assert.equal(levels(diagnoseSettings({ ...READY, AI_ENABLED: 'false', AI_PROVIDER: 'anthropic' })).AI, 'ok')
  assert.ok(diagnoseSettings({ ...READY, DESIGN_CAPTURE_ALLOW_PRIVATE: 'true' }).some((r) => r.level === 'fail' && /private network/.test(r.message)), 'thumbnails must not be allowed to visit private addresses')
})

test('doctor understands company sign-in: a whole provider is ok, half of one fails, bad group settings are flagged', () => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, ...base } = READY
  const oidc = { ...base, OIDC_ISSUER: 'https://acme.okta.com', OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 'secret' }
  assert.match(diagnoseSettings(oidc).find((r) => r.area === 'Sign-in').message, /company sign-in/)
  assert.equal(levels(diagnoseSettings({ ...oidc, OIDC_CLIENT_SECRET: undefined }))['Sign-in'], 'fail')
  const fails = (env) => diagnoseSettings(env).some((r) => r.area === 'Sign-in' && r.level === 'fail')
  assert.ok(fails({ ...oidc, OIDC_ISSUER: 'http://acme.okta.com' }), 'a plain-http issuer')
  assert.ok(fails({ ...oidc, SSO_DEFAULT_ROLE: 'owner' }), 'owners are never added automatically')
  assert.ok(!fails(oidc))
  assert.ok(diagnoseSettings({ ...oidc, SSO_EDITOR_GROUPS: 'e' }).some((r) => r.level === 'warn' && /no owner group/.test(r.message)))
  assert.ok(!diagnoseSettings({ ...oidc, SSO_OWNER_GROUPS: 'o' }).some((r) => r.level === 'warn' && r.area === 'Sign-in'))
})

test('bootstrap builds an empty database into a working workspace, and a second run changes nothing', async () => {
  const pg = new PGlite()
  const client = adapt(pg)
  const before = await diagnoseDatabase(client, { WORKSPACE_SLUG: 'acme' })
  assert.equal(levels(before).Migrations, 'warn', 'a fresh database has everything pending')
  assert.equal(before.length, 1, 'and nothing else is asked of a database with no tables')

  const first = await bootstrap(client, { name: 'Acme Research', slug: 'acme', owners: ['pat@acme.com'] }, quiet)
  assert.ok(first.migrations > 20 && first.created && first.templatesAdded === 4 && first.owners.length === 1)
  const after = await diagnoseDatabase(client, { WORKSPACE_SLUG: 'acme' })
  assert.deepEqual(levels(after), { Migrations: 'ok', Workspace: 'ok' })
  assert.match(after.find((r) => r.area === 'Workspace').message, /"Acme Research" with 1 owner\(s\) and 4 template\(s\)/)

  const again = await bootstrap(client, { name: 'Acme Research', slug: 'acme', owners: ['pat@acme.com'] }, quiet)
  assert.deepEqual([again.migrations, again.created, again.templatesAdded], [0, false, 0])
  const wrong = await diagnoseDatabase(client, { WORKSPACE_SLUG: 'other' })
  assert.equal(levels(wrong).Workspace, 'fail')
  assert.match(wrong.find((r) => r.area === 'Workspace').fix, /--slug other/)
})

test('bad input is refused before the database is touched', async () => {
  const pg = new PGlite()
  const client = adapt(pg)
  await assert.rejects(() => bootstrap(client, { name: 'Acme', slug: 'Bad Slug', owners: ['pat@acme.com'] }, quiet), /slug must be/)
  await assert.rejects(() => bootstrap(client, { name: 'Acme', slug: 'acme', owners: ['not-an-email'] }, quiet), /not an email/)
  await assert.rejects(() => bootstrap(client, { name: 'Acme', slug: 'acme', owners: [] }, quiet), /owner email is required/)
  assert.equal(client.calls.length, 0)
})
