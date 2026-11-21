// Pulse accounts: the customer accounts and ARR copied from Salesforce (server/salesforce.ts), and the matching of a signal's account name to one of them. Read only, owners only
// (every route asks `pulseOn` first). The copy is replaced as a whole on each sync, so an account removed in Salesforce disappears here.
import type { Db, Queryable } from './db.js'
import { SalesforceError, type SalesforceClient } from './salesforce.js'

const SUFFIXES = new Set(['inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'gmbh', 'plc', 'sa', 'ag', 'lp', 'llp'])

/** An account name as it is compared: lower case, "&" as "and", no punctuation, no legal ending ("Inc", "LLC"). "Contoso Health, Inc." and "contoso health" match. */
export function normalizeAccount(name: string): string {
  const words = name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (words.length > 1 && SUFFIXES.has(words[words.length - 1])) words.pop()
  return words.join(' ')
}

export type SalesforceStatus = { connected: boolean; accounts: number; syncedAt: string | null; error: string | null }

export async function salesforceStatus(db: Queryable, ctx: { workspaceId: string }, connected: boolean): Promise<SalesforceStatus> {
  const state = (await db.query(`select synced_at, error from core.pulse_account_sync where workspace_id = $1`, [ctx.workspaceId])).rows[0]
  const n = Number((await db.query(`select count(*)::int as n from core.pulse_accounts where workspace_id = $1`, [ctx.workspaceId])).rows[0].n)
  return { connected, accounts: n, syncedAt: state?.synced_at ? new Date(state.synced_at).toISOString() : null, error: state?.error ?? null }
}

/** Copies the accounts now. A Salesforce problem is kept as the status's error and the old copy stays; it never throws for one. */
export async function syncAccounts(db: Db, who: { workspaceId: string }, sf: SalesforceClient | null): Promise<{ accounts: number; error: string | null }> {
  const ws = who.workspaceId
  let error: string | null = null
  let accounts = 0
  if (!sf) error = 'Salesforce is not connected.'
  else {
    try {
      const fetched = await sf.fetchAccounts()
      // Two Salesforce accounts that read as one name (a duplicate) count once, at the larger ARR, so revenue is never doubled.
      const byKey = new Map<string, { id: string; name: string; arr: number }>()
      for (const a of fetched) {
        const key = normalizeAccount(a.name)
        if (key && (byKey.get(key)?.arr ?? -1) < a.arr) byKey.set(key, a)
      }
      const rows = [...byKey.entries()].map(([name_key, a]) => ({ sf_id: a.id, name: a.name, name_key, arr: a.arr }))
      await db.transaction(async (tx) => {
        await tx.query(`delete from core.pulse_accounts where workspace_id = $1`, [ws])
        if (rows.length) {
          await tx.query(
            `insert into core.pulse_accounts (workspace_id, sf_id, name, name_key, arr)
             select $1, sf_id, name, name_key, arr from jsonb_to_recordset($2::jsonb) as t(sf_id text, name text, name_key text, arr numeric)`,
            [ws, JSON.stringify(rows)],
          )
        }
      })
      accounts = rows.length
    } catch (err) {
      error = err instanceof SalesforceError ? err.message : 'Salesforce could not be reached.'
      if (!(err instanceof SalesforceError)) console.error('salesforce sync failed', err instanceof Error ? err.name : 'error')
    }
  }
  await db.query(
    `insert into core.pulse_account_sync (workspace_id, synced_at, error, tried_at) values ($1, case when $2::text is null then now() end, $2, now())
     on conflict (workspace_id) do update set synced_at = case when $2::text is null then now() else core.pulse_account_sync.synced_at end, error = $2, tried_at = now()`,
    [ws, error],
  )
  return { accounts, error }
}

/** The copied ARR by normalized name, or an empty map when nothing was copied (then topics show no ARR at all). */
export async function arrByName(db: Queryable, workspaceId: string): Promise<Map<string, { name: string; arr: number }>> {
  const rows = (await db.query(`select name, name_key, arr from core.pulse_accounts where workspace_id = $1`, [workspaceId])).rows
  return new Map(rows.map((r: any) => [r.name_key as string, { name: r.name as string, arr: Number(r.arr) }]))
}

/** ARR behind a set of signal account names: each distinct matched account once; the names that matched nothing are counted so the screen can say so. */
export function arrFor(names: (string | null)[], known: Map<string, { name: string; arr: number }>): { arr: number; matched: number; unmatched: number } {
  const seen = new Set<string>()
  let arr = 0
  let matched = 0
  let unmatched = 0
  for (const n of names) {
    const raw = n?.trim()
    if (!raw || /^unknown$/i.test(raw)) continue
    const key = normalizeAccount(raw)
    if (!key || seen.has(key)) continue
    seen.add(key)
    const hit = known.get(key)
    if (hit) {
      arr += hit.arr
      matched++
    } else unmatched++
  }
  return { arr: Math.round(arr * 100) / 100, matched, unmatched }
}

export const SYNC_DUE_MS = 20 * 3600_000
