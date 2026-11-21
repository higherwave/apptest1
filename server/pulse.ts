// Pulse: customer signals gathered by hand (typed in, or split out of pasted notes) and later from a connected channel, for early problem framing.
//
// Slice 1 is a preview. It is for workspace owners only, and only while an owner has turned it on (core.workspace_features), so a viewer, an editor, the read-only
// demo visitor and an owner who has not switched it on all get the same answer as for a page that does not exist. `pulseOn` is the ONE place that decides; every
// /pulse route and the menu (through /me) ask it. Do not re-derive it in a handler or a screen.
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'
import type { SlackClient } from './slack.js'
import { checkAllSources } from './pulse-sources.js'
import { linksFor } from './pulse-links.js'
import { arrByName, arrFor, syncAccounts, SYNC_DUE_MS } from './pulse-accounts.js'
import type { SalesforceClient } from './salesforce.js'
import { bestTopic, CHANNELS, DEFAULT_WEIGHTS, groupSignals, isChannel, playStats, topicStats, type Channel, type InPlay, type TopicStats } from './pulse-topics.js'

export { CHANNELS, isChannel, type Channel }

export const SIGNAL_KINDS = ['complaint', 'request', 'praise', 'question', 'other'] as const
export type SignalKind = (typeof SIGNAL_KINDS)[number]
export type SignalStatus = 'new' | 'kept' | 'dismissed'
export type SignalSource = 'manual' | 'notes' | 'slack' | 'salesforce'

/** The Salesforce opportunity a signal came from, when it did. */
export type Opportunity = { id: string; name: string; amount: number | null; stage: string | null; closeDate: string | null; state: 'open' | 'lost' | 'won' }
export const opportunityOf = (r: Record<string, any>): Opportunity | null =>
  r.opp_id ? { id: r.opp_id, name: r.opp_name ?? '', amount: r.opp_amount === null || r.opp_amount === undefined ? null : Number(r.opp_amount), stage: r.opp_stage ?? null, closeDate: r.opp_close_date ?? null, state: r.opp_state ?? 'open' } : null

export type Signal = {
  id: string
  body: string
  kind: SignalKind
  channel: Channel
  source: SignalSource
  sourceLabel: string | null
  sourceUrl: string | null
  saidBy: string | null
  account: string | null
  occurredOn: string | null
  status: SignalStatus
  createdAt: string
  opportunity: Opportunity | null
}
export type SignalList = { signals: Signal[]; counts: Record<SignalStatus, number> }

export class SignalNotFound extends Error {}

/** Whether an owner has switched the Pulse preview on for this workspace. */
export async function pulseEnabled(db: Queryable, workspaceId: string): Promise<boolean> {
  const row = (await db.query(`select enabled from core.workspace_features where workspace_id = $1 and feature = 'pulse'`, [workspaceId])).rows[0]
  return !!row?.enabled
}

export type PulseAccess = 'edit' | 'view'

/**
 * What this caller may do in Pulse: nothing (null: the answer is the one a page that does not exist would give), view, or edit. Owners and editors (platform editors) edit; any other
 * signed-in member sees Pulse only when an owner has granted them view (a department leader, for example), and a grant never lets them change anything. The read-only visitor and
 * external members never see it, and nobody does while the workspace has the preview off. ONE place decides; every /pulse route and the menu (through /me) ask it.
 */
export async function pulseAccess(db: Queryable, ctx: RequestContext): Promise<PulseAccess | null> {
  if (ctx.anonymous || ctx.external) return null
  if (!(await pulseEnabled(db, ctx.workspaceId))) return null
  if (ctx.role === 'owner' || ctx.role === 'editor') return 'edit'
  const granted = (await db.query(`select 1 from core.pulse_viewers where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, ctx.userId])).rows[0]
  return granted ? 'view' : null
}

/** Whether this caller may see Pulse at all. */
export async function pulseOn(db: Queryable, ctx: RequestContext): Promise<boolean> {
  return (await pulseAccess(db, ctx)) !== null
}

export type PulseViewer = { userId: string; email: string; displayName: string | null; role: string; canView: boolean; always: boolean }

/** The members an owner can grant view to: everyone but external members, with who already has it by being an owner or editor. */
export async function listViewers(db: Queryable, ctx: RequestContext): Promise<PulseViewer[]> {
  const rows = (
    await db.query(
      `select m.user_id, u.email, u.display_name, m.role, (v.user_id is not null) as granted
         from core.memberships m join core.users u on u.id = m.user_id
         left join core.pulse_viewers v on v.workspace_id = m.workspace_id and v.user_id = m.user_id
        where m.workspace_id = $1 and not m.is_external
        order by (m.role = 'owner') desc, (m.role = 'editor') desc, lower(u.email)`,
      [ctx.workspaceId],
    )
  ).rows
  return rows.map((r) => ({ userId: r.user_id, email: r.email, displayName: r.display_name ?? null, role: r.role, always: r.role === 'owner' || r.role === 'editor', canView: r.role === 'owner' || r.role === 'editor' || !!r.granted }))
}

export class NotGrantable extends Error {}

/** An owner gives or takes away view access for one member (a viewer; owners and editors always have it). Recorded in the audit log. */
export async function setViewer(db: Db, ctx: RequestContext, userId: string, canView: boolean): Promise<PulseViewer[]> {
  await db.transaction(async (tx) => {
    const m = (await tx.query(`select role, is_external from core.memberships where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, userId])).rows[0]
    if (!m || m.is_external || m.role === 'owner' || m.role === 'editor') throw new NotGrantable()
    const had = !!(await tx.query(`select 1 from core.pulse_viewers where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, userId])).rows[0]
    if (canView && !had) await tx.query(`insert into core.pulse_viewers (workspace_id, user_id, granted_by) values ($1, $2, $3)`, [ctx.workspaceId, userId, ctx.userId])
    if (!canView && had) await tx.query(`delete from core.pulse_viewers where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, userId])
    if (canView !== had) await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.pulse_viewers', entity_id: userId, verb: canView ? 'granted view' : 'removed view', after: { feature: 'pulse' } }])
  })
  return listViewers(db, ctx)
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
  channel: r.channel,
  source: r.source,
  sourceLabel: r.source_label ?? null,
  sourceUrl: r.source_url ?? null,
  saidBy: r.said_by ?? null,
  account: r.account ?? null,
  occurredOn: r.occurred_on ?? null,
  status: r.status,
  createdAt: new Date(r.created_at).toISOString(),
  opportunity: opportunityOf(r),
})

const SELECT = `select id, body, kind, channel, source, source_label, source_url, said_by, account, to_char(occurred_on, 'YYYY-MM-DD') as occurred_on, status, created_at, opp_id, opp_name, opp_amount, opp_stage, to_char(opp_close_date, 'YYYY-MM-DD') as opp_close_date, opp_state from core.pulse_signals`

export async function listSignals(db: Queryable, ctx: RequestContext, status?: SignalStatus): Promise<SignalList> {
  const rows = (await db.query(`${SELECT} where workspace_id = $1 and ($2::text is null or status = $2) order by coalesce(occurred_on, created_at::date) desc, created_at desc limit 500`, [ctx.workspaceId, status ?? null])).rows
  const counts = { new: 0, kept: 0, dismissed: 0 } as Record<SignalStatus, number>
  for (const r of (await db.query(`select status, count(*)::int as n from core.pulse_signals where workspace_id = $1 group by status`, [ctx.workspaceId])).rows) counts[r.status as SignalStatus] = r.n
  return { signals: rows.map(toSignal), counts }
}

export type NewSignal = { body: string; kind?: SignalKind; channel?: Channel; sourceLabel?: string | null; sourceUrl?: string | null; saidBy?: string | null; account?: string | null; occurredOn?: string | null }
const clean = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null)

/** A signal typed in by a person. A person who adds one has already judged it, so it starts kept. */
export async function addSignal(db: Queryable, ctx: RequestContext, input: NewSignal): Promise<Signal> {
  const row = (
    await db.query(
      `insert into core.pulse_signals (workspace_id, body, kind, channel, source, source_label, source_url, said_by, account, occurred_on, status, kept_at, created_by)
       values ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, 'kept', now(), $10) returning id`,
      [ctx.workspaceId, input.body.trim(), input.kind ?? 'other', input.channel ?? 'call_notes', clean(input.sourceLabel), clean(input.sourceUrl), clean(input.saidBy), clean(input.account), input.occurredOn ?? null, ctx.userId],
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
export async function importNotes(db: Db, ctx: RequestContext, input: { text: string; channel?: Channel; sourceLabel?: string | null; account?: string | null; occurredOn?: string | null }): Promise<{ created: number; skipped: number }> {
  const all = splitNotes(input.text)
  const parts = all.slice(0, MAX_IMPORT)
  if (!parts.length) return { created: 0, skipped: 0 }
  await db.transaction(async (tx) => {
    await insertMany(
      tx,
      'core.pulse_signals',
      parts.map((body) => ({ workspace_id: ctx.workspaceId, body, kind: 'other', channel: input.channel ?? 'call_notes', source: 'notes', source_label: clean(input.sourceLabel), account: clean(input.account), occurred_on: input.occurredOn ?? null, status: 'new', created_by: ctx.userId })),
    )
  })
  return { created: parts.length, skipped: all.length - parts.length }
}

/** Keep, dismiss or put back a signal, and optionally say what kind it is. */
export async function updateSignal(db: Queryable, ctx: RequestContext, id: string, patch: { status?: SignalStatus; kind?: SignalKind; channel?: Channel }): Promise<Signal> {
  const found = (await db.query(`select id from core.pulse_signals where id = $1 and workspace_id = $2`, [id, ctx.workspaceId])).rows[0]
  if (!found) throw new SignalNotFound()
  await db.query(`update core.pulse_signals set kept_at = case when $2 = 'kept' and status <> 'kept' then now() else kept_at end, status = coalesce($2, status), kind = coalesce($3, kind), channel = coalesce($4, channel) where id = $1`, [id, patch.status ?? null, patch.kind ?? null, patch.channel ?? null])
  return toSignal((await db.query(`${SELECT} where id = $1`, [id])).rows[0])
}


// Weights ----------------------------------------------------------------------------------------------------------------------

export type Weights = Record<Channel, number>

/** What a signal from each channel counts for in this workspace: its own setting, else the default. */
export async function getWeights(db: Queryable, workspaceId: string): Promise<Weights> {
  const w: Weights = { ...DEFAULT_WEIGHTS }
  for (const r of (await db.query(`select channel, weight::float8 as weight from core.pulse_weights where workspace_id = $1`, [workspaceId])).rows) if (isChannel(r.channel)) w[r.channel] = Number(r.weight)
  return w
}

/** An owner changes some or all weights. Recorded in the audit log with what each was before. */
export async function setWeights(db: Db, ctx: RequestContext, patch: Partial<Weights>): Promise<Weights> {
  await db.transaction(async (tx) => {
    const before = await getWeights(tx, ctx.workspaceId)
    for (const [channel, weight] of Object.entries(patch)) {
      if (!isChannel(channel) || weight === undefined) continue
      await tx.query(
        `insert into core.pulse_weights (workspace_id, channel, weight, updated_by) values ($1, $2, $3, $4)
         on conflict (workspace_id, channel) do update set weight = excluded.weight, updated_by = excluded.updated_by, updated_at = now()`,
        [ctx.workspaceId, channel, weight, ctx.userId],
      )
    }
    const after = await getWeights(tx, ctx.workspaceId)
    if (JSON.stringify(before) !== JSON.stringify(after)) await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.pulse_weights', entity_id: null, verb: 'changed', before, after }])
  })
  return getWeights(db, ctx.workspaceId)
}

// Topics -----------------------------------------------------------------------------------------------------------------------

export class TopicNotFound extends Error {}
export class BadSplit extends Error {}

export type Topic = TopicStats & {
  id: string
  title: string
  edited: boolean
  rank: number
  /** The ARR of the distinct accounts behind the signals that were found in Salesforce; null when no accounts have been copied from Salesforce. */
  arr: number | null
  /** How many of those accounts were found in Salesforce, and how many were not (so the number is never mistaken for the whole). */
  arrMatched: number
  arrUnmatched: number
  /** Links to Signal Flow: projects started from this topic, and Platform Insights themes that already cover it. */
  /** What is at stake from Salesforce opportunity notes behind the topic; null when none. */
  inPlay: InPlay | null
  projects: { id: string; name: string }[]
  researched: { id: string; title: string }[]
}
export type TopicList = {
  topics: Topic[]
  weights: Weights
  updatedAt: string | null
  /** Kept signals that are in no topic yet (a signal on its own is not a topic). */
  unsorted: number
  /** Signals waiting for a person to keep or dismiss them. */
  toReview: number
  /** Kept signals added since topics were last updated. */
  sinceUpdate: number
}

type Actor = { workspaceId: string; userId: string | null }

/**
 * Brings topics up to date with the kept signals. `attach`: signals that were un-kept leave their topic, a new signal joins the topic it fits best, and what fits nowhere is grouped
 * among itself. `regroup`: first drops every topic a person has not touched, then does the same, so everything not edited is grouped afresh. A topic a person renamed, merged or split is
 * never regrouped. Rankings only change here, never when a signal is merely kept, so a page does not shift while someone reads it.
 */
export async function updateTopics(db: Db, who: Actor, mode: 'attach' | 'regroup'): Promise<{ topics: number; attached: number; created: number }> {
  return db.transaction(async (tx) => {
    const ws = who.workspaceId
    await tx.query(`delete from core.pulse_topic_signals where workspace_id = $1 and signal_id in (select id from core.pulse_signals where workspace_id = $1 and status <> 'kept')`, [ws])
    if (mode === 'regroup') await tx.query(`delete from core.pulse_topics where workspace_id = $1 and edited = false and status = 'active'`, [ws])
    // Topics a person edited that are now empty stay out of the way; an untouched empty one is just removed.
    await tx.query(`delete from core.pulse_topics t where t.workspace_id = $1 and t.status = 'active' and not exists (select 1 from core.pulse_topic_signals s where s.topic_id = t.id)`, [ws])

    const loose = (await tx.query(`select id, body from core.pulse_signals where workspace_id = $1 and status = 'kept' and id not in (select signal_id from core.pulse_topic_signals) order by occurred_on desc nulls last, created_at, id`, [ws])).rows as { id: string; body: string }[]
    const existing = (await tx.query(`select t.id, s.body from core.pulse_topics t join core.pulse_topic_signals ts on ts.topic_id = t.id join core.pulse_signals s on s.id = ts.signal_id where t.workspace_id = $1 and t.status = 'active'`, [ws])).rows as { id: string; body: string }[]
    const byTopic = new Map<string, string[]>()
    for (const r of existing) byTopic.set(r.id, [...(byTopic.get(r.id) ?? []), r.body])
    const topics = [...byTopic.entries()].map(([id, bodies]) => ({ id, bodies }))

    let attached = 0
    const rest: { id: string; body: string }[] = []
    for (const sig of loose) {
      const into = bestTopic(sig.body, topics)
      if (into) {
        await tx.query(`insert into core.pulse_topic_signals (signal_id, topic_id, workspace_id) values ($1, $2, $3)`, [sig.id, into, ws])
        topics.find((t) => t.id === into)!.bodies.push(sig.body)
        attached++
      } else rest.push(sig)
    }
    let created = 0
    for (const g of groupSignals(rest)) {
      const topic = (await tx.query(`insert into core.pulse_topics (workspace_id, title, created_by) values ($1, $2, $3) returning id`, [ws, g.title, who.userId])).rows[0]
      await insertMany(tx, 'core.pulse_topic_signals', g.ids.map((id) => ({ signal_id: id, topic_id: topic.id, workspace_id: ws })))
      created++
    }
    await tx.query(
      `insert into core.pulse_state (workspace_id, updated_at, last_regroup_at, updated_by) values ($1, now(), case when $2 then now() end, $3)
       on conflict (workspace_id) do update set updated_at = now(), last_regroup_at = case when $2 then now() else core.pulse_state.last_regroup_at end, updated_by = excluded.updated_by`,
      [ws, mode === 'regroup', who.userId],
    )
    const total = Number((await tx.query(`select count(*)::int as n from core.pulse_topics where workspace_id = $1 and status = 'active'`, [ws])).rows[0].n)
    return { topics: total, attached, created }
  })
}

/** Topics with every number computed from their kept signals and the weights, ranked by score. */
export async function listTopics(db: Queryable, ctx: RequestContext, today: Date = new Date()): Promise<TopicList> {
  const ws = ctx.workspaceId
  const weights = await getWeights(db, ws)
  const topicRows = (await db.query(`select id, title, edited from core.pulse_topics where workspace_id = $1 and status = 'active'`, [ws])).rows
  const sigRows = (
    await db.query(
      `select ts.topic_id, s.body, s.channel, s.account, s.account_sf_id, s.opp_id, s.opp_amount, s.opp_state, to_char(s.opp_close_date, 'YYYY-MM-DD') as opp_close_date, s.said_by, to_char(s.occurred_on, 'YYYY-MM-DD') as occurred_on, s.created_at
         from core.pulse_topic_signals ts join core.pulse_signals s on s.id = ts.signal_id where ts.workspace_id = $1 and s.status = 'kept'`,
      [ws],
    )
  ).rows
  const known = await arrByName(db, ws)
  const by = new Map<string, typeof sigRows>()
  for (const r of sigRows) by.set(r.topic_id, [...(by.get(r.topic_id) ?? []), r])
  const topics = topicRows
    .map((t) => {
      const rows = by.get(t.id) ?? []
      const money = arrFor(rows.map((r) => ({ name: r.account as string | null, sfId: (r.account_sf_id as string | null) ?? null })), known)
      return {
        id: t.id as string,
        title: t.title as string,
        edited: !!t.edited,
        ...topicStats(rows.map((r) => ({ channel: r.channel as Channel, account: r.account, saidBy: r.said_by, occurredOn: r.occurred_on, createdAt: new Date(r.created_at).toISOString() })), weights, today),
        arr: known.size ? money.arr : null,
        arrMatched: money.matched,
        arrUnmatched: money.unmatched,
        inPlay: playStats(rows.map((r) => ({ oppId: r.opp_id ?? null, amount: r.opp_amount === null || r.opp_amount === undefined ? null : Number(r.opp_amount), state: r.opp_state ?? null, closeDate: r.opp_close_date ?? null })), today),
        projects: [] as Topic['projects'],
        researched: [] as Topic['researched'],
        bodies: rows.map((r) => r.body as string),
      }
    })
    .filter((t) => t.signals > 0)
    .sort((a, b) => b.score - a.score || b.signals - a.signals || a.title.localeCompare(b.title))
  const links = await linksFor(db, ws, topics)
  const ranked: Topic[] = topics.map(({ bodies: _bodies, ...t }, i) => ({ ...t, rank: i + 1, projects: links.get(t.id)?.projects ?? [], researched: links.get(t.id)?.researched ?? [] }))
  const state = (await db.query(`select updated_at from core.pulse_state where workspace_id = $1`, [ws])).rows[0]
  const counts = (
    await db.query(
      `select count(*) filter (where status = 'new')::int as to_review,
              count(*) filter (where status = 'kept' and id not in (select signal_id from core.pulse_topic_signals))::int as unsorted,
              count(*) filter (where status = 'kept' and $2::timestamptz is not null and coalesce(kept_at, created_at) > $2::timestamptz)::int as since
         from core.pulse_signals where workspace_id = $1`,
      [ws, state ? new Date(state.updated_at).toISOString() : null],
    )
  ).rows[0]
  return { topics: ranked, weights, updatedAt: state ? new Date(state.updated_at).toISOString() : null, unsorted: counts.unsorted, toReview: counts.to_review, sinceUpdate: counts.since }
}

export async function renameTopic(db: Queryable, ctx: RequestContext, id: string, title: string): Promise<void> {
  const r = await db.query(`update core.pulse_topics set title = $3, edited = true, updated_at = now() where id = $1 and workspace_id = $2 and status = 'active' returning id`, [id, ctx.workspaceId, title.trim()])
  if (!r.rows.length) throw new TopicNotFound()
}

/** Everything in `id` moves into `intoId`; `id` is marked merged and the target counts as edited. */
export async function mergeTopic(db: Db, ctx: RequestContext, id: string, intoId: string): Promise<void> {
  if (id === intoId) throw new BadSplit()
  await db.transaction(async (tx) => {
    const found = (await tx.query(`select id from core.pulse_topics where workspace_id = $1 and status = 'active' and id = any($2::uuid[])`, [ctx.workspaceId, [id, intoId]])).rows
    if (found.length !== 2) throw new TopicNotFound()
    await tx.query(`update core.pulse_topic_signals set topic_id = $2 where topic_id = $1 and workspace_id = $3`, [id, intoId, ctx.workspaceId])
    await tx.query(`update core.pulse_topics set status = 'merged', merged_into = $2, updated_at = now() where id = $1`, [id, intoId])
    await tx.query(`update core.pulse_topics set edited = true, updated_at = now() where id = $1`, [intoId])
  })
}

/** Moves the chosen signals out of a topic into a new one. Both count as edited. */
export async function splitTopic(db: Db, ctx: RequestContext, id: string, signalIds: string[], title: string): Promise<string> {
  return db.transaction(async (tx) => {
    const found = (await tx.query(`select id from core.pulse_topics where id = $1 and workspace_id = $2 and status = 'active'`, [id, ctx.workspaceId])).rows[0]
    if (!found) throw new TopicNotFound()
    const inTopic = (await tx.query(`select signal_id from core.pulse_topic_signals where topic_id = $1 and signal_id = any($2::uuid[])`, [id, signalIds])).rows.map((r) => r.signal_id as string)
    const total = Number((await tx.query(`select count(*)::int as n from core.pulse_topic_signals where topic_id = $1`, [id])).rows[0].n)
    if (!inTopic.length || inTopic.length !== new Set(signalIds).size || inTopic.length >= total) throw new BadSplit()
    const created = (await tx.query(`insert into core.pulse_topics (workspace_id, title, edited, created_by) values ($1, $2, true, $3) returning id`, [ctx.workspaceId, title.trim(), ctx.userId])).rows[0]
    await tx.query(`update core.pulse_topic_signals set topic_id = $2 where topic_id = $1 and signal_id = any($3::uuid[])`, [id, created.id, inTopic])
    await tx.query(`update core.pulse_topics set edited = true, updated_at = now() where id = $1`, [id])
    return created.id as string
  })
}

/** The scheduled update for every workspace that has the preview on: new signals attach hourly, and everything not edited is regrouped about once a day. Never throws for one workspace. */
export async function runPulseUpdates(platformDb: Db, slackFor?: (workspaceId: string) => Promise<SlackClient>, salesforceFor?: (workspaceId: string) => Promise<SalesforceClient | null>): Promise<{ workspaces: number; regrouped: number; read: number }> {
  const on = (await platformDb.query(`select workspace_id from core.workspace_features where feature = 'pulse' and enabled`)).rows as { workspace_id: string }[]
  let regrouped = 0
  let read = 0
  for (const { workspace_id } of on) {
    try {
      const db = platformDb.inWorkspace(workspace_id)
      // Salesforce accounts are copied about once a day (only when this workspace has connected it), so the ARR on topics is fresh without a call every hour.
      if (salesforceFor) {
        const sf = await salesforceFor(workspace_id)
        if (sf) {
          const last = (await db.query(`select tried_at from core.pulse_account_sync where workspace_id = $1`, [workspace_id])).rows[0]
          if (!last || Date.now() - new Date(last.tried_at).getTime() > SYNC_DUE_MS) await syncAccounts(db, { workspaceId: workspace_id }, sf)
        }
      }
      // Designated feedback channels are read first, so what they add is grouped in the same run.
      if (slackFor || salesforceFor) read += (await checkAllSources(db, { workspaceId: workspace_id, userId: null }, { slack: slackFor ? await slackFor(workspace_id) : null, salesforce: salesforceFor ? await salesforceFor(workspace_id) : null })).added
      const state = (await db.query(`select last_regroup_at from core.pulse_state where workspace_id = $1`, [workspace_id])).rows[0]
      const due = !state?.last_regroup_at || Date.now() - new Date(state.last_regroup_at).getTime() > 20 * 3600_000
      await updateTopics(db, { workspaceId: workspace_id, userId: null }, due ? 'regroup' : 'attach')
      if (due) regrouped++
    } catch (err) {
      console.error('pulse update failed', err instanceof Error ? err.message : err)
    }
  }
  return { workspaces: on.length, regrouped, read }
}
