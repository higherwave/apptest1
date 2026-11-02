// Says whether an environment is ready, and what to do about each gap. Read-only: it changes nothing.
//
//   npm run doctor                 checks files and settings (from the environment and db/.env.local)
//   npm run doctor -- --db         also connects to the database: migrations, workspace, owners
//
// Exits 1 when something required is missing. Warnings (a demo setting left on, AI not configured) do not fail it.
import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import pg from 'pg'
import { loadBrand } from './brand.mjs'
import { findConnectionString, loadEnvFile, migrationFiles } from '../db/migrate.mjs'

const root = resolve(import.meta.dirname, '..')
const ok = (area, message) => ({ area, level: 'ok', message })
const warn = (area, message, fix) => ({ area, level: 'warn', message, fix })
const fail = (area, message, fix) => ({ area, level: 'fail', message, fix })

/** Checks that need no network. `env` is the settings the app will run with. */
export function diagnoseSettings(env, appRoot = root) {
  const out = []
  const major = Number(process.versions.node.split('.')[0])
  out.push(major >= 20 ? ok('Node', `v${process.versions.node}`) : fail('Node', `v${process.versions.node} is too old`, 'Install Node 20 or newer (22 recommended).'))

  try {
    const b = loadBrand(join(appRoot, 'brand', 'brand.json'))
    out.push(ok('Brand', `${b.appName} by ${b.orgName} (${b.orgDomain})`))
  } catch (e) {
    out.push(fail('Brand', e.message, 'Edit brand/brand.json, or apply a pack: npm run brand:apply -- <dir> --yes.'))
  }

  const src = join(appRoot, 'vendor', 'design-rules', 'SOURCE.json')
  if (!existsSync(src)) out.push(fail('Design rules', 'vendor/design-rules is missing', 'Run: npm run rules:sync -- --repo <owner>/<design-system-repo>'))
  else {
    const s = JSON.parse(readFileSync(src, 'utf8'))
    const bad = Object.entries(s.files ?? {}).filter(([f, m]) => !existsSync(join(appRoot, 'vendor', 'design-rules', f)) || createHash('sha256').update(readFileSync(join(appRoot, 'vendor', 'design-rules', f))).digest('hex') !== m.sha256)
    out.push(bad.length ? fail('Design rules', `${bad.map(([f]) => f).join(', ')} differ from SOURCE.json`, 'Never edit vendor/ by hand: run npm run rules:sync.') : ok('Design rules', `pinned from ${s.repo} @ ${String(s.commit).slice(0, 7)}`))
  }

  out.push(findConnectionString(env) ? ok('Database', 'a connection string is set') : fail('Database', 'no connection string', 'Set DATABASE_URL_UNPOOLED (and DATABASE_URL) in the host, or in db/.env.local for commands run here.'))

  const slug = env.WORKSPACE_SLUG || env.DEMO_WORKSPACE_SLUG
  out.push(slug ? ok('Workspace', `WORKSPACE_SLUG=${slug}`) : warn('Workspace', 'WORKSPACE_SLUG is not set, so the app looks for the demo workspace "higherwave-demo"', 'Create your workspace (npm run bootstrap) and set WORKSPACE_SLUG to its slug.'))

  const base = ['BETTER_AUTH_URL', 'BETTER_AUTH_SECRET'].filter((k) => !env[k])
  const google = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((k) => !env[k])
  const oidc = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'].filter((k) => !env[k])
  const anyProvider = google.length < 2 || oidc.length < 3
  if (!anyProvider && base.length === 2) out.push(warn('Sign-in', 'not configured: nobody can sign in', 'Set BETTER_AUTH_URL, BETTER_AUTH_SECRET (openssl rand -base64 32) and either OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET (your company sign-in) or GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'))
  else if (base.length || (google.length && google.length < 2) || (oidc.length && oidc.length < 3) || (google.length === 2 && oidc.length === 3)) {
    const missing = [...base, ...(google.length < 2 ? google : []), ...(oidc.length < 3 ? oidc : [])]
    out.push(fail('Sign-in', `partly configured: missing ${missing.join(', ') || 'a provider'}`, 'Set BETTER_AUTH_URL and BETTER_AUTH_SECRET, then every setting of one provider (the three OIDC_* or the two GOOGLE_*).'))
  } else out.push(ok('Sign-in', oidc.length === 0 ? 'configured (company sign-in)' : 'configured (Google)'))
  if (oidc.length === 0) {
    if (env.OIDC_ISSUER && !/^https:\/\//.test(env.OIDC_ISSUER) && !/^http:\/\/(localhost|127\.)/.test(env.OIDC_ISSUER)) out.push(fail('Sign-in', 'OIDC_ISSUER is not an https address', 'Use the issuer URL from your identity provider, for example https://acme.okta.com'))
    const groupsOn = !!(env.SSO_OWNER_GROUPS || env.SSO_EDITOR_GROUPS || env.SSO_VIEWER_GROUPS)
    if (groupsOn && !env.SSO_OWNER_GROUPS) out.push(warn('Sign-in', 'sign-in groups decide roles but no owner group is set', 'Set SSO_OWNER_GROUPS so someone can manage the workspace (and keep DEV_TOKEN or bootstrap for emergencies).'))
    if (env.SSO_DEFAULT_ROLE && !['viewer', 'editor'].includes(env.SSO_DEFAULT_ROLE.toLowerCase())) out.push(fail('Sign-in', `SSO_DEFAULT_ROLE=${env.SSO_DEFAULT_ROLE} is not viewer or editor`, 'Owners are never added automatically. Use viewer or editor, or unset it.'))
    if (env.SSO_DEFAULT_ROLE && env.GOOGLE_CLIENT_ID && !env.SSO_ALLOWED_DOMAINS) out.push(warn('Sign-in', 'SSO_DEFAULT_ROLE is set while Google sign-in is on, but SSO_ALLOWED_DOMAINS is not: nobody will be added automatically', 'Set SSO_ALLOWED_DOMAINS to your company domain, or turn Google sign-in off.'))
    if (!groupsOn && !env.SSO_DEFAULT_ROLE) out.push(ok('Sign-in', 'invitation only: each person is invited on the Members page'))
  }
  if (env.BETTER_AUTH_SECRET && env.BETTER_AUTH_SECRET.length < 32) out.push(fail('Sign-in', 'BETTER_AUTH_SECRET is shorter than 32 characters', 'Use: openssl rand -base64 32'))

  if (env.DESIGN_CAPTURE_ALLOW_PRIVATE === 'true') out.push(fail('Access', 'DESIGN_CAPTURE_ALLOW_PRIVATE=true lets thumbnails visit private network addresses', 'Remove it: it is for tests only.'))

  const production = env.VERCEL_ENV === 'production' || env.NODE_ENV === 'production'
  if (env.OPEN_EDITING === 'true') out.push(warn('Access', 'OPEN_EDITING=true: anyone with the link can edit', 'A company deployment sets OPEN_EDITING=false.'))
  else out.push(ok('Access', env.OPEN_EDITING === 'false' ? 'editing needs an invitation' : 'OPEN_EDITING is not on'))
  if (env.PUBLIC_VIEW === 'true' && slug && slug !== 'higherwave-demo') out.push(warn('Access', 'PUBLIC_VIEW=true on your own workspace: visitors without an account get a read-only view that needs the demo user', 'Set PUBLIC_VIEW=false for a company deployment.'))
  if (production && env.DEV_TOKEN) out.push(warn('Access', 'DEV_TOKEN is set in production', 'Remove it unless scripts need it; it is a shared password.'))

  if (env.AI_ENABLED === 'false') out.push(ok('AI', 'switched off (AI_ENABLED=false): the free simulation is used'))
  else if (env.AI_PROVIDER && env.ANTHROPIC_API_KEY) out.push(ok('AI', `live (${env.AI_PROVIDER}); monthly budget $${env.AI_MONTHLY_BUDGET_USD || '10 (default)'}`))
  else if (env.AI_PROVIDER || env.ANTHROPIC_API_KEY) out.push(fail('AI', 'partly configured: set both AI_PROVIDER and ANTHROPIC_API_KEY, or neither', 'The app stays on the simulation until both are set.'))
  else out.push(warn('AI', 'not configured: the free simulation is used', 'Optional. Set AI_PROVIDER=anthropic, ANTHROPIC_API_KEY and AI_MONTHLY_BUDGET_USD, and check public/privacy.html first.'))
  return out
}

/** Checks that read the database. `client` has query(sql, params). */
export async function diagnoseDatabase(client, env) {
  const out = []
  const exists = (await client.query(`select to_regclass('public.schema_migrations') as t`)).rows[0].t
  const applied = exists ? (await client.query('select name from public.schema_migrations')).rows.map((r) => r.name) : []
  const pending = migrationFiles().filter((f) => !applied.includes(f))
  out.push(pending.length ? warn('Migrations', `${pending.length} pending (${pending[0]}${pending.length > 1 ? ', ...' : ''})`, 'Run: npm run bootstrap, or let a production build apply them.') : ok('Migrations', `up to date (${applied.length})`))
  if (pending.length === migrationFiles().length) return out
  const slug = env.WORKSPACE_SLUG || env.DEMO_WORKSPACE_SLUG || 'higherwave-demo'
  const ws = (await client.query('select id, name from core.workspaces where slug = $1', [slug])).rows[0]
  if (!ws) return [...out, fail('Workspace', `no workspace "${slug}" in the database`, `Run: npm run bootstrap -- --name "Your company" --slug ${slug} --owners you@example.com --yes`)]
  const owners = (await client.query(`select count(*)::int n from core.memberships where workspace_id = $1 and role = 'owner'`, [ws.id])).rows[0].n
  const templates = (await client.query(`select count(*)::int n from core.templates where workspace_id = $1`, [ws.id])).rows[0].n
  out.push(owners ? ok('Workspace', `"${ws.name}" with ${owners} owner(s) and ${templates} template(s)`) : fail('Workspace', `"${ws.name}" has no owner, so nobody can manage it`, 'Run: node db/bootstrap-owners.mjs you@example.com --yes'))
  return out
}

export function print(results, log = console.log) {
  const mark = { ok: '  ok  ', warn: ' warn ', fail: ' FAIL ' }
  for (const r of results) log(`${mark[r.level]} ${r.area.padEnd(13)} ${r.message}${r.fix && r.level !== 'ok' ? `\n${' '.repeat(20)}-> ${r.fix}` : ''}`)
  const f = results.filter((r) => r.level === 'fail').length
  const w = results.filter((r) => r.level === 'warn').length
  log(`\n${f} to fix, ${w} to consider.`)
  return f
}

if (process.argv[1] === import.meta.filename) {
  loadEnvFile()
  const results = diagnoseSettings(process.env)
  if (process.argv.includes('--db')) {
    const url = findConnectionString(process.env)
    if (url) {
      const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') })
      try {
        await client.connect()
        results.push(...(await diagnoseDatabase(client, process.env)))
      } catch (e) {
        results.push(fail('Database', `could not connect: ${e.message}`, 'Check the connection string and that the database is not paused.'))
      } finally {
        await client.end().catch(() => {})
      }
    }
  }
  process.exit(print(results) ? 1 : 0)
}
