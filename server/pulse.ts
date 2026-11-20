// Pulse: customer signals gathered by hand (typed in, or split out of pasted notes) and later from a connected channel, for early problem framing.
//
// Slice 1 is a preview. It is for workspace owners only, and only while an owner has turned it on (core.workspace_features), so a viewer, an editor, the read-only
// demo visitor and an owner who has not switched it on all get the same answer as for a page that does not exist. `pulseOn` is the ONE place that decides; every
// /pulse route and the menu (through /me) ask it. Do not re-derive it in a handler or a screen.
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'

export const SIGNAL_KINDS = ['complaint', 'request', 'praise', 'question', 'other'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]
export type SignalStatus = 'new' | 'kept' | 'dismissed'
export type SignalSource = 'manual' | 'notes' | 'slack'

export type Signal = {
  id: string
  body: string
  kind: SignalKind
  source: SignalSource
  sourceLabel: string | null
  sourceUrl: string | null
  saidBy: string | null
  account: string | null
  occurredOn: string | null
  status: SignalStatus
  createdAt: string
}
export type SignalList = { signals: Signal[]; counts: Record<SignalStatus, number> }

export class SignalNotFound extends Error {}

/** Whether an owner has switched the Pulse preview on for this workspace. */
export async function pulseEnabled(db: Queryable, workspaceId: string): Promise<boolean> {
  const row = (await db.query(`select enabled from core.workspace_features where workspace_id = $1 and feature = 'pulse'`, [workspaceId])).rows[0]
  return !!row?.enabled
}

/** Whether this caller may see Pulse at all: a signed-in owner of a workspace that has it switched on. Anyone else never learns it exists. */
export async function pulseOn(db: Queryable, ctx: RequestContext): Promise<boolean> {
  if (ctx.anonymous || ctx.external || ctx.role !== 'owner') return false
  return pulseEnabled(db, ctx.workspaceId)
}

/** An owner turns the preview on or off. Recorded in the audit log. */
export async function setPulsePreview(db: Db, ctx: RequestContext, enabled: boolean): Promise<void> {
  await db.transaction(async (tx) => {
    const was = await pulseEnabled(tx, ctx.workspaceId)
    await tx.query(
      `insert into core.workspace_features (workspace_id, feature, enabled, updated_by) values ($1, 'pulse', $2, $3)
       on conflict (workspace_id, feature) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now()`,
      [ctx.workspaceId, enabled, ctx.userId],
    )
    if (was !== enabled) {
      await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.workspace_features', entity_id: null, verb: enabled ? 'turned on' : 'turned off', after: { feature: 'pulse' } }])
    }
  })
}

const toSignal = (r: Record<string, any>): Signal => ({
  id: r.id,
  body: r.body,
  kind: r.kind,
  source: r.source,
  sourceLabel: r.source_label ?? null,
  sourceUrl: r.source_url ?? null,
  saidBy: r.said_by ?? null,
  account: r.account ?? null,
  occurredOn: r.occurred_on ?? null,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
})

const SELECT = `select id, body, kind, source, source_label, source_url, said_by, account, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on, status, created_at from core.pulse_signals`

export async function listSignals(db: Queryable, ctx: RequestContext, status?: SignalStatus): Promise<SignalList> {
  const rows = (await db.query(`${SELECT} where workspace_id = $1 and ($2::text is null or status = $2) order by coalesce(occurred_on, created_at::date) desc, created_at desc limit 500`, [ctx.workspaceId, status ?? null])).rows
  const counts = { new: 0, kept: 0, dismissed: 0 } as Record<SignalStatus, number>
  for (const r of (await db.query(`select status, count(*)::int as n from core.pulse_signals where workspace_id = $1 group by status`, [ctx.workspaceId])).rows) counts[r.status as SignalStatus] = r.n
  return { signals: rows.map(toSignal), counts }
}

export type NewSignal = { body: string; kind?: SignalKind; sourceLabel?: string | null; sourceUrl?: string | null; saidBy?: string | null; account?: string | null; occurredOn?: string | null }
const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)

/** A signal typed in by a person. A person who adds one has already judged it, so it starts kept. */
export async function addSignal(db: Queryable, ctx: RequestContext, input: NewSignal): Promise<Signal> {
  const row = (
    await db.query(
      `insert into core.pulse_signals (workspace_id, body, kind, source, source_label, source_url, said_by, account, occurred_on, status, created_by)
       values ($1, $2, $3, 'manual', $4, $5, $6, $7, $8, 'kept', $9) returning id`,
      [ctx.workspaceId, input.body.trim(), input.kind ?? 'other', clean(input.sourceLabel), clean(input.sourceUrl), clean(input.saidBy), clean(input.account), input.occurredOn ?? null, ctx.userId],
    )
  ).rows[0]
  return toSignal((await db.query(`${SELECT} where id = $1`, [row.id])).rows[0])
}

/** Notes pasted in (or read from a text file): one signal per paragraph, or per line when there are no blank lines. Bullets and numbering are dropped. */
export function splitNotes(text: string): string[] {
  const normal = text.replace(/\r\n?/g, '\n').trim()
  if (!normal) return []
  const chunks = /\n\s*\n/.test(normal) ? normal.split(/\n\s*\n/) : normal.split('\n')
  return chunks
    .map((c) => c.split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean).join(' '))
    .filter((c) => c.length >= 12)
    .map((c) => (c.length > 4000 ? c.slice(0, 4000) : c))
}

export const MAX_IMPORT = 200

/** Splits notes into signals that wait for review (status new). Returns how many were made, and how many paragraphs were left out when over the cap. */
export async function importNotes(db: Db, ctx: RequestContext, input: { text: string; sourceLabel?: string | null; account?: string | null; occurredOn?: string | null }): Promise<{ created: number; skipped: number }> {
  const all = splitNotes(input.text)
  const parts = all.slice(0, MAX_IMPORT)
  if (!parts.length) return { created: 0, skipped: 0 }
  await db.transaction(async (tx) => {
    await insertMany(
      tx,
      'core.pulse_signals',
      parts.map((body) => ({ workspace_id: ctx.workspaceId, body, kind: 'other', source: 'notes', source_label: clean(input.sourceLabel), account: clean(input.account), occurred_on: input.occurredOn ?? null, status: 'new', created_by: ctx.userId })),
    )
  })
  return { created: parts.length, skipped: all.length - parts.length }
}

/** Keep, dismiss or put back a signal, and optionally say what kind it is. */
export async function updateSignal(db: Queryable, ctx: RequestContext, id: string, patch: { status?: SignalStatus; kind?: SignalKind }): Promise<Signal> {
  const found = (await db.query(`select id from core.pulse_signals where id = $1 and workspace_id = $2`, [id, ctx.workspaceId])).rows[0]
  if (!found) throw new SignalNotFound()
  await db.query(`update core.pulse_signals set status = coalesce($2, status), kind = coalesce($3, kind) where id = $1`, [id, patch.status ?? null, patch.kind ?? null])
  return toSignal((await db.query(`${SELECT} where id = $1`, [id])).rows[0])
}
