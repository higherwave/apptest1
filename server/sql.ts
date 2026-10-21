import type { Queryable } from './db.js'

// Multi-row insert with parameters, so a create is a handful of statements, not hundreds.
export async function insertMany(db: Queryable, table: string, rows: Record<string, unknown>[]): Promise<void> {
  if (!rows.length) return
  const cols = Object.keys(rows[0])
  const params: unknown[] = []
  const tuples = rows.map(
    (row) =>
      '(' +
      cols
        .map((c) => {
          const v = row[c] === undefined ? null : row[c]
          params.push(v !== null && typeof v === 'object' && !Array.isArray(v) ? JSON.stringify(v) : v)
          return '$' + params.length
        })
        .join(',') +
      ')',
  )
  await db.query(`insert into ${table} (${cols.join(',')}) values ${tuples.join(',')}`, params)
}
