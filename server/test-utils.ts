import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import type { Db, Queryable } from './db.js'
import type { AuthService } from './auth.js'
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

// A stand-in for the sign-in service in tests and the in-memory dev server: a request whose "x-test-user" header (or
// "sf_test_user" cookie, which a browser test can set) holds JSON for a person ({ id, email, name?, verified? }) is
// signed in as them. It never talks to Google, and only the tests and server/dev-memory.ts (AUTH_TEST=true) use it.
export function fakeAuth(): AuthService {
  return {
    handler: async () => new Response('fake auth', { status: 200 }),
    async user(headers) {
      const cookie = /(?:^|;\s*)sf_test_user=([^;]+)/.exec(headers.get('cookie') ?? '')?.[1]
      const raw = headers.get('x-test-user') ?? (cookie ? decodeURIComponent(cookie) : null)
      if (!raw) return null
      const u = JSON.parse(raw)
      return { id: u.id, email: u.email, name: u.name ?? '', image: u.image ?? null, emailVerified: u.verified !== false }
    },
  }
}
