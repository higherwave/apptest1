import pg from 'pg'
import { neon } from '@neondatabase/serverless'
import { ApiError } from './errors.js'

export type Env = Record<string, string | undefined>
export type Queryable = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }> }
// transaction() runs fn on one connection between BEGIN and COMMIT, and rolls back if fn throws.
export type Db = Queryable & {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  /**
   * The same database as one workspace sees it: every query runs as the restricted role sf_app, in its own transaction, with the workspace
   * set, so row-level security answers only for that workspace (migration 0047). Each query still succeeds or fails alone, as before.
   */
  inWorkspace(workspaceId: string): Db
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** The same statement with the workspace as a parameter ($1), for drivers that send statement and values separately. */
const scopeSqlParam = `select set_config('role', 'sf_app', true), set_config('app.workspace_id', $1, true)`
/** The statement that makes the current transaction act as one workspace. The id is checked to be a UUID, so it is safe to write inline (which saves a round trip). */
export function scopeSql(workspaceId: string): string {
  if (!UUID_RE.test(workspaceId)) throw new Error('A workspace id must be a UUID.')
  return `select set_config('role', 'sf_app', true), set_config('app.workspace_id', '${workspaceId.toLowerCase()}', true)`
}

// The Neon integration adds a prefix to its variable names (for example <PREFIX>_DATABASE_URL), so
// match by suffix. Serverless functions use the pooled string; migrations use the unpooled one.
export function findConnectionString(env: Env, kind: 'pooled' | 'direct' = 'pooled'): string | undefined {
  const suffixes = kind === 'pooled' ? ['DATABASE_URL', 'POSTGRES_URL'] : ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING']
  for (const suffix of suffixes) {
    const key = Object.keys(env).find((k) => k === suffix || k.endsWith('_' + suffix))
    const value = key ? env[key] : undefined
    if (value && /^postgres(ql)?:\/\//.test(value)) return value
  }
  return undefined
}

// Make the TLS mode explicit (it is what pg already does for sslmode=require) and drop the
// channel_binding option, which pg ignores. Parsed as a URL, so parameter order does not matter.
export function cleanConnectionString(url: string): string {
  const u = new URL(url)
  u.searchParams.delete('channel_binding')
  if (u.searchParams.get('sslmode') === 'require') u.searchParams.set('sslmode', 'verify-full')
  return u.toString()
}

// Errors that mean "the database cannot be reached": suspended compute (Neon Free stops at its limit),
// network failures, or a missing connection string. Anything else is a bug and stays a 500.
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', '57P01', '57P03', '53300', '08000', '08001', '08003', '08004', '08006'])
const UNREACHABLE_MESSAGE = /connection terminated|timeout|timed out|compute.*(suspend|quota)|quota|could not connect/i

export function databaseUnavailable(detail?: string) {
  return new ApiError(503, 'db_unavailable', 'The demo database is paused or unreachable.' + (detail ? ` (${detail})` : ''))
}

function mapDbError(err: unknown): unknown {
  const e = err as { code?: string; message?: string }
  if ((e.code && UNREACHABLE.has(e.code)) || (e.message && UNREACHABLE_MESSAGE.test(e.message))) return databaseUnavailable(e.code)
  return err
}

export function wrapDb(inner: Db): Db {
  return {
    async query(sql, params) {
      try {
        return await inner.query(sql, params)
      } catch (err) {
        throw mapDbError(err)
      }
    },
    async transaction(fn) {
      try {
        return await inner.transaction(fn)
      } catch (err) {
        throw mapDbError(err)
      }
    },
    inWorkspace: (id) => wrapDb(inner.inWorkspace(id)),
  }
}

// One connection pool per app, created on first use. The data routes and the sign-in library share it, so the app never
// holds more connections than Neon's pooler allows.
export function lazyPool(env: Env): () => pg.Pool | undefined {
  let pool: pg.Pool | undefined
  return () => {
    if (pool) return pool
    const url = findConnectionString(env, 'pooled')
    if (!url) return undefined
    pool = new pg.Pool({ connectionString: cleanConnectionString(url), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 })
    return pool
  }
}

// Created on first use, so a route that never touches the database (GET /health) never opens a connection.
export function lazyPgDb(env: Env, getPool: () => pg.Pool | undefined = lazyPool(env)): () => Db {
  let db: Db | undefined
  return () => {
    if (db) return db
    const pool = getPool()
    if (!pool) {
      const unavailable = async (): Promise<never> => {
        throw databaseUnavailable('no connection string configured')
      }
      const dead: Db = { query: unavailable, transaction: unavailable, inWorkspace: () => dead }
      return dead
    }
    // On Neon, one scoped query is a single HTTP request that runs the workspace setting and the query together in one transaction: one round
    // trip, like a plain query, instead of three over a pooled connection. Anywhere else (a local Postgres), the pool is used for it too.
    const url = findConnectionString(env, 'pooled')
    const http = url && /\.neon\.tech(:|\/|$)/.test(new URL(url).host) && env.DB_SCOPED_HTTP !== 'false' ? neon(cleanConnectionString(url)) : undefined
    const make = (workspaceId?: string): Db => {
      // With a workspace, begin and the scope are one round trip; the transaction is the same one the query (or the whole callback) runs in.
      const open = async (client: pg.PoolClient) => {
        if (workspaceId) await client.query(`begin; ${scopeSql(workspaceId)}`)
        else await client.query('begin')
      }
      const inTransaction = async <T>(fn: (q: Queryable) => Promise<T>): Promise<T> => {
        const client = await pool.connect()
        try {
          await open(client)
          const result = await fn({ query: (sql, params) => client.query(sql, params as unknown[]) })
          await client.query('commit')
          return result
        } catch (err) {
          await client.query('rollback').catch(() => undefined)
          throw err
        } finally {
          client.release()
        }
      }
      return {
        // Without a workspace this is the platform's own path (one plain query); with one, each query is its own small transaction.
        query: workspaceId
          ? http
            ? async (sql, params) => {
                if (!UUID_RE.test(workspaceId)) throw new Error('A workspace id must be a UUID.')
                const [, rows] = await http.transaction([http.query(`${scopeSqlParam}`, [workspaceId]), http.query(sql, params as unknown[])])
                return { rows: rows as Record<string, any>[] }
              }
            : (sql, params) => inTransaction((q) => q.query(sql, params))
          : (sql, params) => pool.query(sql, params as unknown[]),
        transaction: inTransaction,
        inWorkspace: (id) => make(id),
      }
    }
    db = wrapDb(make())
    return db
  }
}
