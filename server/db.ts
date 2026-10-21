import pg from 'pg'
import { ApiError } from './errors.js'

export type Env = Record<string, string | undefined>
export type Db = { query(sql: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }> }

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

export function wrapDb(inner: Db): Db {
  return {
    async query(sql, params) {
      try {
        return await inner.query(sql, params)
      } catch (err) {
        const e = err as { code?: string; message?: string }
        if ((e.code && UNREACHABLE.has(e.code)) || (e.message && UNREACHABLE_MESSAGE.test(e.message))) {
          throw databaseUnavailable(e.code)
        }
        throw err
      }
    },
  }
}

// Created on first use, so a route that never touches the database (GET /health) never opens a connection.
export function lazyPgDb(env: Env): () => Db {
  let db: Db | undefined
  return () => {
    if (db) return db
    const url = findConnectionString(env, 'pooled')
    if (!url) {
      return {
        query: async () => {
          throw databaseUnavailable('no connection string configured')
        },
      }
    }
    const pool = new pg.Pool({ connectionString: cleanConnectionString(url), max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 8_000 })
    db = wrapDb({ query: (sql, params) => pool.query(sql, params as unknown[]) })
    return db
  }
}
