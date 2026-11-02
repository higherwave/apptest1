// Migrate on deploy: when it runs, what it refuses, and that a failure stops the build without leaving a half-applied migration.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error plain ESM helper shared with the db/ tooling
import { deployMigrate, shouldRun } from '../db/deploy-migrate.mjs'
// @ts-expect-error plain ESM helper shared with the db/ tooling
import { destructiveStatements, migrationFiles } from '../db/migrate.mjs'

// The same two calls a pg client has. PGlite runs a statement with no parameters through exec, which allows a whole migration file.
const adapt = (pg: PGlite) => {
  const calls: string[] = []
  return {
    calls,
    query: async (sql: string, params?: unknown[]) => {
      calls.push(sql)
      if (params?.length) return pg.query(sql, params as unknown[])
      const r = await pg.exec(sql)
      return { rows: r.at(-1)?.rows ?? [] }
    },
  }
}
const quiet = () => {
  const lines: string[] = []
  return { lines, log: (l: string) => lines.push(l) }
}
const PROD = { VERCEL_ENV: 'production' }
const names = async (pg: PGlite) => ((await pg.query<{ name: string }>('select name from public.schema_migrations order by name')).rows).map((r) => r.name)

test('it runs only on a production build, unless told otherwise', () => {
  assert.equal(shouldRun({ VERCEL_ENV: 'production' }).run, true)
  assert.equal(shouldRun({ VERCEL_ENV: 'preview' }).run, false)
  assert.equal(shouldRun({}).run, false, 'a laptop build never touches the database')
  assert.equal(shouldRun({ MIGRATE_ON_DEPLOY: 'true' }).run, true, 'another CI turns it on')
  assert.equal(shouldRun({ VERCEL_ENV: 'production', MIGRATE_ON_DEPLOY: 'false' }).run, false, 'and any build can turn it off')
})

test('a skipped build makes no database call at all', async () => {
  const pg = new PGlite()
  const client = adapt(pg)
  const { log, lines } = quiet()
  for (const env of [{}, { VERCEL_ENV: 'preview' }, { VERCEL_ENV: 'production', MIGRATE_ON_DEPLOY: 'false' }]) {
    assert.deepEqual(await deployMigrate({ env, client, log }), { status: 'skipped', applied: [] })
  }
  assert.equal(client.calls.length, 0)
  assert.equal(lines.length, 3)
  await assert.rejects(() => deployMigrate({ env: PROD, log }), /no database connection string/, 'a production build with no database stops, not silently deploys')
})

test('on a production build every real migration is applied in order, and a second run finds nothing to do', async () => {
  const pg = new PGlite()
  const { log } = quiet()
  const first = await deployMigrate({ env: PROD, client: adapt(pg), log })
  assert.equal(first.status, 'applied')
  assert.deepEqual(first.applied, migrationFiles())
  assert.deepEqual(await names(pg), migrationFiles())
  const second = await deployMigrate({ env: PROD, client: adapt(pg), log })
  assert.deepEqual(second, { status: 'none', applied: [] })
  // The schema really is there, not just the bookkeeping rows.
  assert.equal(((await pg.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_schema = 'insights' and table_type = 'BASE TABLE'`)).rows[0]).n, 9)
})

test('only the pending migrations are applied when some already are', async () => {
  const pg = new PGlite()
  const all = migrationFiles() as string[]
  const { log } = quiet()
  await deployMigrate({ env: PROD, client: adapt(pg), files: all.slice(0, all.length - 2), log })
  const r = await deployMigrate({ env: PROD, client: adapt(pg), log })
  assert.deepEqual(r.applied, all.slice(-2))
})

const FILES: Record<string, string> = {
  '0001_a.sql': 'create table public.a (id int);',
  '0002_b.sql': 'create table public.b (id int);',
  '0003_drop.sql': '-- clean up\nalter table public.a add column note text;\ndrop table public.b;',
}
const fakes = (extra: Record<string, string> = {}) => {
  const all = { ...FILES, ...extra }
  return { files: Object.keys(all).sort(), read: (f: string) => all[f] }
}

test('a destructive pending migration stops the build, and nothing else is applied before the check', async () => {
  const pg = new PGlite()
  const { log } = quiet()
  await deployMigrate({ env: PROD, client: adapt(pg), log, files: ['0001_a.sql'], read: fakes().read }) // a database that already has data
  await assert.rejects(
    () => deployMigrate({ env: PROD, client: adapt(pg), log, ...fakes() }),
    (e: Error) => /destructive/.test(e.message) && e.message.includes('0003_drop.sql') && e.message.includes('drop table public.b') && !e.message.includes('0001_a.sql'),
  )
  assert.deepEqual(await names(pg), ['0001_a.sql'], 'the safe migration ahead of it was not applied either')
  assert.equal(((await pg.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_name = 'b'`)).rows[0]).n, 0)
})

test('the allow-destructive line lets a reviewed migration through', async () => {
  const pg = new PGlite()
  const { log } = quiet()
  await deployMigrate({ env: PROD, client: adapt(pg), log, files: ['0001_a.sql'], read: fakes().read })
  const r = await deployMigrate({ env: PROD, client: adapt(pg), log, ...fakes({ '0003_drop.sql': `-- migrate: allow-destructive\n${FILES['0003_drop.sql']}` }) })
  assert.deepEqual(r.applied, ['0002_b.sql', '0003_drop.sql'])
})

test('an empty database is built from scratch without the check, so a new environment can start', async () => {
  const pg = new PGlite()
  const { log } = quiet()
  const r = await deployMigrate({ env: PROD, client: adapt(pg), log, ...fakes() })
  assert.deepEqual(r.applied, ['0001_a.sql', '0002_b.sql', '0003_drop.sql'])
})

test('a failing migration is rolled back whole, earlier ones stay applied, and the build is told', async () => {
  const pg = new PGlite()
  const { log } = quiet()
  const bad = fakes({ '0003_drop.sql': 'create table public.c (id int);\ninsert into public.nope values (1);' })
  await assert.rejects(() => deployMigrate({ env: PROD, client: adapt(pg), log, ...bad }), /0003_drop\.sql failed and was rolled back/)
  assert.deepEqual(await names(pg), ['0001_a.sql', '0002_b.sql'])
  assert.equal(((await pg.query<{ n: number }>(`select count(*)::int n from information_schema.tables where table_name = 'c'`)).rows[0]).n, 0, 'its first statement was undone too')
})

test('the destructive check reads code, not comments, and ignores harmless drops', () => {
  assert.deepEqual(destructiveStatements('-- drop table x;\ncreate table y (id int);'), [])
  assert.deepEqual(destructiveStatements('drop trigger if exists t on a;\ndrop view v;\ndrop function f();\ndrop index i;\nalter table a drop constraint c;'), [])
  assert.equal(destructiveStatements('DROP TABLE IF EXISTS a;').length, 1)
  assert.equal(destructiveStatements('alter table a drop column b;').length, 1)
  assert.equal(destructiveStatements('truncate a;').length, 1)
  assert.equal(destructiveStatements('delete from a where id = 1;').length, 1)
  assert.equal(destructiveStatements('drop schema s cascade;').length, 1)
})
