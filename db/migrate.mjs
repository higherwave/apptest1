// Applies SQL migrations in db/migrations to a Postgres database (Neon).
//
//   node migrate.mjs status            show applied and pending migrations
//   node migrate.mjs up   [--yes]      apply pending migrations, each in its own transaction
//   node migrate.mjs down [--yes]      roll back the most recent migration
//
// The connection string comes from DATABASE_URL_UNPOOLED, then DATABASE_URL, in the environment
// or in db/.env.local (gitignored). Without --yes the command only prints what it would do.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');

function loadEnvFile() {
  const file = join(here, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function migrationFiles() {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f) && !f.endsWith('.down.sql'))
    .sort();
}

const [cmd = 'status', ...flags] = process.argv.slice(2);
const yes = flags.includes('--yes');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadEnvFile();
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) {
    console.error('No DATABASE_URL found. Put it in db/.env.local (see db/README.md).');
    process.exit(1);
  }
  const host = new URL(url).host;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // `status` is read-only: it must not create the bookkeeping table.
    const exists = (await client.query(`select to_regclass('public.schema_migrations') as t`)).rows[0].t;
    if (!exists && cmd !== 'status') {
      await client.query(`create table public.schema_migrations (
        name text primary key, applied_at timestamptz not null default now())`);
    }
    const applied = (exists || cmd !== 'status')
      ? (await client.query('select name from public.schema_migrations order by name')).rows.map((r) => r.name)
      : [];
    const pending = migrationFiles().filter((f) => !applied.includes(f));
    console.log(`Target: ${host}`);
    console.log(`Applied: ${applied.length ? applied.join(', ') : 'none'}`);
    console.log(`Pending: ${pending.length ? pending.join(', ') : 'none'}`);

    if (cmd === 'up') {
      if (!pending.length) process.exit(0);
      if (!yes) { console.log('\nDry run. Re-run with --yes to apply.'); process.exit(0); }
      for (const f of pending) {
        await client.query('begin');
        try {
          await client.query(readFileSync(join(dir, f), 'utf8'));
          await client.query('insert into public.schema_migrations (name) values ($1)', [f]);
          await client.query('commit');
          console.log(`applied ${f}`);
        } catch (e) {
          await client.query('rollback');
          throw new Error(`${f} failed and was rolled back: ${e.message}`);
        }
      }
    } else if (cmd === 'down') {
      const last = applied[applied.length - 1];
      if (!last) { console.log('Nothing to roll back.'); process.exit(0); }
      console.log(`Would roll back: ${last}  (this deletes that schema and all its data)`);
      if (!yes) { console.log('\nDry run. Re-run with --yes to roll back.'); process.exit(0); }
      await client.query('begin');
      try {
        await client.query(readFileSync(join(dir, last.replace(/\.sql$/, '.down.sql')), 'utf8'));
        await client.query('delete from public.schema_migrations where name = $1', [last]);
        await client.query('commit');
        console.log(`rolled back ${last}`);
      } catch (e) {
        await client.query('rollback');
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}
