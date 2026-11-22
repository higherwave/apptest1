import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'
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

// Called synchronously when a database is requested, so it closes with whatever was running then: the test that asked for it, or the
// whole file when it was asked for at the top (a shared database). Only under `node --test`: the in-memory dev servers import this file too.
function closeWhenDone(get: () => PGlite | undefined): void {
  if (!process.env.NODE_TEST_CONTEXT) return
  after(async () => {
    await get()?.close().catch(() => {})
  })
}

// Walks a folder and returns every file's path and size/mtime, so the snapshot key changes whenever a migration or the seed does.
function fingerprint(): string {
  const root = new URL('../db/', import.meta.url).pathname
  const h = createHash('sha256')
  const walk = (dir: string) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) walk(path)
      else h.update(path.slice(root.length)).update(readFileSync(path))
    }
  }
  walk(join(root, 'migrations'))
  walk(join(root, 'seed'))
  h.update(readFileSync(join(root, 'migrate.mjs')))
  h.update(readFileSync(new URL('../node_modules/@electric-sql/pglite/package.json', import.meta.url)))
  return h.digest('hex').slice(0, 16)
}

// The migrated and seeded database is built once per machine (until a migration or the seed changes) and every test database
// starts from that snapshot: loading it takes about 0.5 s, building it again about 2.4 s and every copy of that work added memory.
let snapshot: Promise<Blob> | undefined
function baseSnapshot(): Promise<Blob> {
  snapshot ??= (async () => {
    const dir = join(tmpdir(), 'signal-flow-test-db')
    const file = join(dir, `${fingerprint()}.tar`)
    if (existsSync(file)) return new Blob([readFileSync(file)])
    const pglite = new PGlite()
    for (const f of migrationFiles()) await pglite.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'))
    await pglite.exec(`create table if not exists public.schema_migrations (name text primary key, applied_at timestamptz default now())`)
    await pglite.exec(`grant select on public.schema_migrations to sf_app`) // the migration tool's own bookkeeping table, which the health check reads
    for (const f of migrationFiles()) await pglite.query('insert into public.schema_migrations (name) values ($1) on conflict do nothing', [f])
    await seed(pglite)
    const blob = (await pglite.dumpDataDir('none')) as Blob
    await pglite.close()
    try {
      mkdirSync(dir, { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()))
      renameSync(tmp, file) // atomic, so test files running side by side never read half a file
    } catch {
      // no cache this time; the snapshot still serves this process
    }
    return blob
  })()
  return snapshot
}

// A migrated and seeded in-memory database, with the bookkeeping table the health check reads.
// With { anchor: true } the Anchor CX demo story is loaded beside it (the original demo's tests count on it being absent).
/** `keepOpen`: a database shared by many tests but created lazily inside the first one that needs it, so it must outlive that test (the process end frees it). `drafts`: the seeded requirements documents are returned to draft, so their projects are not locked (a published document locks its project: server/lock.ts). */
export async function createDemoDatabase(options: { anchor?: boolean; drafts?: boolean; keepOpen?: boolean } = {}): Promise<{ pglite: PGlite; db: Db }> {
  let pglite: PGlite | undefined
  if (!options.keepOpen) closeWhenDone(() => pglite)
  pglite = new PGlite({ loadDataDir: await baseSnapshot() })
  await pglite.waitReady
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
