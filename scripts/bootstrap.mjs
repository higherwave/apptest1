// Stands up a new environment's database in one command: applies every migration, creates the workspace with its templates, and
// invites the first owners. No demo data. Safe to run again.
//
//   npm run bootstrap -- --name "Acme Research" --slug acme --owners a@acme.com,b@acme.com          shows the plan
//   npm run bootstrap -- --name "Acme Research" --slug acme --owners a@acme.com,b@acme.com --yes    does it
//
// The connection string comes from the environment or db/.env.local. Run `npm run doctor -- --db` afterwards.
import pg from 'pg'
import { deployMigrate } from '../db/deploy-migrate.mjs'
import { checkInput, initWorkspace } from '../db/init-workspace.mjs'
import { findConnectionString, loadEnvFile } from '../db/migrate.mjs'

/** `client` has query(sql, params). Migrations apply first (each in its own transaction), then the workspace in one. */
export async function bootstrap(client, { name, slug, owners }, log = console.log) {
  // Fail on a bad name, slug or owners before touching the database.
  checkInput({ name, slug, owners })
  const migrated = await deployMigrate({ env: { MIGRATE_ON_DEPLOY: 'true' }, client, log })
  await client.query('begin')
  try {
    const ws = await initWorkspace(client, { name, slug, owners })
    await client.query('commit')
    return { migrations: migrated.applied.length, ...ws }
  } catch (e) {
    await client.query('rollback')
    throw e
  }
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2)
  const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined)
  const input = { name: flag('--name'), slug: flag('--slug'), owners: (flag('--owners') || '').split(',').map((e) => e.trim()).filter(Boolean) }
  loadEnvFile()
  const url = findConnectionString(process.env)
  if (!url) {
    console.error('No connection string found. Set DATABASE_URL_UNPOOLED, or put it in db/.env.local.')
    process.exit(1)
  }
  try {
    checkInput(input)
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
  console.log(`Target: ${new URL(url).host}\nWorkspace "${input.name}" (${input.slug}); owners: ${input.owners.join(', ')}`)
  if (!args.includes('--yes')) {
    console.log('Dry run: would apply any pending migrations, then create the workspace and its owners. Add --yes to do it.')
    process.exit(0)
  }
  const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') })
  await client.connect()
  try {
    const r = await bootstrap(client, input)
    console.log(`\n${r.migrations} migration(s) applied. ${r.created ? 'Created' : 'Found'} the workspace; ${r.templatesAdded} template(s) added; owners: ${r.owners.join(', ')}.`)
    console.log(`\nNext, in the host's environment settings:\n  WORKSPACE_SLUG=${input.slug}\n  OPEN_EDITING=false\n  PUBLIC_VIEW=false\n  plus the sign-in settings (docs/SETUP.md, step 6)\nThen: npm run doctor -- --db`)
  } catch (e) {
    console.error(e.message)
    process.exitCode = 1
  } finally {
    await client.end()
  }
}
