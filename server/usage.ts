// System usage: how much of a limit the app has used, for the Admin > System usage tab. Today one row, the database's size against the plan's
// limit (read from the database itself: no outside service or access key is involved, and it costs one tiny query). More rows (compute hours,
// bandwidth, build minutes) can be added to getUsage when those accounts are on paid plans and worth connecting.
import type { Queryable } from './db.js'

export type UsageLevel = 'ok' | 'half' | 'high' | 'reached'
export type UsageRow = {
  key: string
  label: string
  /** Null when it could not be read. */
  used: number | null
  /** Null when no limit is set. */
  limit: number | null
  unit: 'bytes'
  level: UsageLevel
  note: string
}

const MB = 1024 * 1024
const DEFAULT_LIMIT_MB = 512

/** The database size limit in bytes: DATABASE_SIZE_LIMIT_MB (default 512, a free plan's usual half gigabyte); 0 or "none" means no limit. */
export function databaseLimitBytes(env: Record<string, string | undefined>): number | null {
  const raw = env.DATABASE_SIZE_LIMIT_MB?.trim()
  if (raw === undefined || raw === '') return DEFAULT_LIMIT_MB * MB
  if (raw.toLowerCase() === 'none') return null
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 0) return DEFAULT_LIMIT_MB * MB
  return n === 0 ? null : Math.round(n * MB)
}

/** Same steps as the AI spend alerts: half, 80% and the whole limit. */
export const levelOf = (used: number | null, limit: number | null): UsageLevel => {
  if (used === null || !limit) return 'ok'
  const share = used / limit
  return share >= 1 ? 'reached' : share >= 0.8 ? 'high' : share >= 0.5 ? 'half' : 'ok'
}

export async function getUsage(db: Queryable, env: Record<string, string | undefined>): Promise<UsageRow[]> {
  let used: number | null = null
  try {
    used = Number((await db.query(`select pg_database_size(current_database()) as bytes`)).rows[0].bytes)
  } catch {
    used = null
  }
  const limit = databaseLimitBytes(env)
  return [
    {
      key: 'database',
      label: 'Database size',
      used,
      limit,
      unit: 'bytes',
      level: levelOf(used, limit),
      note: 'Everything the app stores: research, themes, requirements, the audit log. Set DATABASE_SIZE_LIMIT_MB to your plan’s limit (0 for none).',
    },
  ]
}
