import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db, Queryable } from './db.js'
// @ts-expect-error plain ESM helpers shared with the db/ tooling
import { migrationFiles } from '../db/migrate.mjs'
// @ts-expect-error plain ESM seed
import { seed } from '../db/seed/seed.mjs'

type Rows = { rows: Record<string, any>[] }

// Adapts an in-memory Postgres (PGlite) to the API's Db interface, including transactions.
export function pgliteDb(pg: PGlite): Db {
  const q = (target: { query: (s: string, p?: unknown[]) => Promise<unknown> }): Queryable => ({
    query: async (sql, params) => (await target.query(sql, params as unknown[])) as Rows,
  })
  return {
    ...q(pg),
    transaction: (fn) => pg.transaction((tx) => fn(q(tx))),
  }
}

// A migrated and seeded in-memory database, with the bookkeeping table the health check reads.
export async function createDemoDatabase(): Promise<{ pglite: PGlite; db: Db }> {
  const pglite = new PGlite()
  for (const f of migrationFiles()) await pglite.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'))
  await pglite.exec(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz default now())`)
  for (const f of migrationFiles()) await pglite.query('insert into public.schema_migrations (name) values ($1) on conflict do nothing', [f])
  await seed(pglite)
  return { pglite, db: pgliteDb(pglite) }
}
