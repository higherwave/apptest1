// Applies pending migrations as the last step of a production build, so the new code never goes live ahead of its schema.
//
//   node db/deploy-migrate.mjs
//
// It runs after the app has built (so a failed build changes nothing) and before the deployment takes traffic (so a failed
// migration leaves the previous deployment serving). Each migration is its own transaction, and a lock keeps two overlapping
// builds from applying the same migration twice.
//
// When it runs:
//   MIGRATE_ON_DEPLOY unset   only on a Vercel production build (VERCEL_ENV=production); previews and local builds skip it
//   MIGRATE_ON_DEPLOY=true    always (for another CI or host: set it where the production build runs)
//   MIGRATE_ON_DEPLOY=false   never (the manual command `node db/migrate.mjs up --yes` still works)
//
// What it refuses (on a database that already has data, not on an empty one): a pending migration with a destructive statement (drop table, drop column, drop schema, drop type, truncate,
// delete from) unless the file carries the line `-- migrate: allow-destructive`. The build then fails and says which statement,
// so a person looks before data is lost. Add the line, or apply that migration by hand, and deploy again.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { ALLOW_DESTRUCTIVE, applyMigration, destructiveStatements, findConnectionString, loadEnvFile, migrationFiles } from './migrate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const LOCK_KEY = 7_041_601; // any constant; every deploy of this app uses the same one

export function shouldRun(env) {
  if (env.MIGRATE_ON_DEPLOY === 'false') return { run: false, why: 'MIGRATE_ON_DEPLOY=false' };
  if (env.MIGRATE_ON_DEPLOY === 'true') return { run: true };
  if (env.VERCEL_ENV === 'production') return { run: true };
  return { run: false, why: `not a production build (VERCEL_ENV=${env.VERCEL_ENV || 'unset'}); set MIGRATE_ON_DEPLOY=true to run it here` };
}

/**
 * Plans and applies pending migrations. `client` is anything with query() and, optionally, end(): the real one is a pg client;
 * the tests pass an in-memory database. Returns what happened; throws when the build should fail.
 */
export async function deployMigrate({ env = process.env, client, files = migrationFiles(), read = (f) => readFileSync(join(here, 'migrations', f), 'utf8'), log = console.log } = {}) {
  const gate = shouldRun(env);
  if (!gate.run) {
    log(`Migrations skipped: ${gate.why}.`);
    return { status: 'skipped', applied: [] };
  }
  let own = false;
  if (!client) {
    const url = findConnectionString(env);
    if (!url) throw new Error('Migrations are on for this build but no database connection string was found (DATABASE_URL_UNPOOLED or DATABASE_URL).');
    client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
    await client.connect();
    own = true;
    log(`Target: ${new URL(url).host}`);
  }
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      await client.query(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
      const applied = (await client.query('select name from public.schema_migrations order by name')).rows.map((r) => r.name);
      const pending = files.filter((f) => !applied.includes(f));
      if (!pending.length) {
        log(`Migrations: database is up to date (${applied.length} applied).`);
        return { status: 'none', applied: [] };
      }
      log(`Migrations pending: ${pending.join(', ')}`);
      // Check every pending file before applying any, so a blocked one does not leave the others half done. A brand-new database
      // (nothing applied yet) has nothing to lose, so building one from scratch, as a new environment does, is never blocked.
      const fresh = applied.length === 0;
      const blocked = (fresh ? [] : pending)
        .map((f) => ({ f, sql: read(f) }))
        .filter(({ sql }) => !sql.includes(ALLOW_DESTRUCTIVE))
        .map(({ f, sql }) => ({ f, found: destructiveStatements(sql) }))
        .filter((b) => b.found.length);
      if (blocked.length) {
        const lines = blocked.flatMap((b) => b.found.map((s) => `  ${b.f}: ${s}`));
        throw new Error(`Refusing to apply automatically: destructive statement(s) in a pending migration.\n${lines.join('\n')}\nReview it, then add the line "${ALLOW_DESTRUCTIVE}" to the file, or apply it by hand with: node db/migrate.mjs up --yes`);
      }
      const done = [];
      for (const f of pending) {
        await applyMigration(client, f, read(f));
        done.push(f);
        log(`applied ${f}`);
      }
      return { status: 'applied', applied: done };
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => undefined);
    }
  } finally {
    if (own) await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvFile();
  try {
    await deployMigrate();
  } catch (e) {
    console.error(`\nMigration step failed: ${e.message}`);
    process.exit(1);
  }
}
