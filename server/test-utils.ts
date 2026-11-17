import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { scopeSql, type Db, type Queryable } from './db.js'
import type { AuthService } from './auth.js'
// @ts-expect-error plain ESM helpers shared with the db/ tooling
import { migrationFiles } from '../db/migrate.mjs'
// @ts-expect-error plain ESM seed
import { seed, uid } from '../db/seed/seed.mjs'
// @ts-expect-error plain ESM seed
import { loadAnchorCx } from '../db/seed/anchor-cx/load.mjs'

type Rows = { rows: Record<string, any>[] }

// Adapts an in-memory Postgres (PGlite) to the API's Db interface, including transactions.
export function pgliteDb(pg: PGlite, workspaceId?: string): Db {
  const q = (target: { query: (s: string, p?: unknown[]) => Promise<unknown> }): Queryable => ({
    query: async (sql, params) => (await target.query(sql, params as unknown[])) as Rows,
  })
  // With a workspace, each query is its own small transaction run as the restricted role with the workspace set, exactly as in production.
  const inTx = <T>(fn: (tx: Queryable) => Promise<T>): Promise<T> =>
    pg.transaction(async (tx) => {
      if (workspaceId) await tx.query(scopeSql(workspaceId))
      return fn(q(tx))
    })
  return {
    ...(workspaceId ? { query: (sql: string, params?: unknown[]) => inTx((t) => t.query(sql, params)) } : q(pg)),
    transaction: workspaceId ? inTx : (fn) => pg.transaction((tx) => fn(q(tx))),
    inWorkspace: (id) => pgliteDb(pg, id),
  }
}

// A migrated and seeded in-memory database, with the bookkeeping table the health check reads.
// With { anchor: true } the Anchor CX demo story is loaded beside it (the original demo's tests count on it being absent).
/** `drafts`: the seeded requirements documents are returned to draft, so their projects are not locked (a published document locks its project: server/lock.ts). */
export async function createDemoDatabase(options: { anchor?: boolean; drafts?: boolean } = {}): Promise<{ pglite: PGlite; db: Db }> {
  const pglite = new PGlite()
  for (const f of migrationFiles()) await pglite.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'))
  await pglite.exec(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz default now())`)
  await pglite.exec(`grant select on public.schema_migrations to sf_app`) // the migration tool's own bookkeeping table, which the health check reads
  for (const f of migrationFiles()) await pglite.query('insert into public.schema_migrations (name) values ($1) on conflict do nothing', [f])
  await seed(pglite)
  if (options.anchor) await loadAnchorCx(pglite, { workspaceId: uid('workspace'), userId: uid('user:david') })
  if (options.drafts) await pglite.query(`update delivery.specs set status = 'draft', published_at = null`)
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
      return { id: u.id, email: u.email, name: u.name ?? '', image: u.image ?? null, emailVerified: u.verified !== false, groups: u.groups ?? [] }
    },
  }
}

type ApiCall = (method: string, path: string, body?: unknown) => Promise<Response> | Response

/**
 * Sets one person up as approver (`primary`) or backup (`alternate`) for some steps, for the workspace (`'all'`) or as a team's own, through the Approvals API.
 * `who` is an email, or the part before the @. Keeps whatever else each step already has, and returns the response of the last save.
 */
export async function setApprovers(call: ApiCall, who: string, steps: string[], role: 'primary' | 'alternate' = 'primary', teams: 'all' | string[] = 'all'): Promise<Response> {
  const overview = (await (await call('GET', '/approvals')).json()) as { steps: any[]; people: { userId: string; email: string }[] }
  const person = overview.people.find((p) => p.email === who || p.email.startsWith(`${who}@`))
  if (!person) throw new Error(`no such person: ${who}`)
  let last!: Response
  for (const key of steps) {
    const fresh = (await (await call('GET', '/approvals')).json()) as { steps: any[] }
    const s = fresh.steps.find((x) => x.key === key)
    const body: any = {
      approver: s?.approver?.userId ?? null,
      backup: s?.backup?.userId ?? null,
      teams: Object.fromEntries((s?.teams ?? []).map((t: any) => [t.teamId, { mode: t.mode, approver: t.approver?.userId ?? null, backup: t.backup?.userId ?? null }])),
    }
    const field = role === 'primary' ? 'approver' : 'backup'
    if (teams === 'all') body[field] = person.userId
    else for (const id of teams) body.teams[id] = { ...(body.teams[id] ?? {}), mode: 'custom', [field]: person.userId }
    last = await call('PUT', `/approvals/steps/${key}`, body)
  }
  return last
}
