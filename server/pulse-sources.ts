// Pulse sources: the places Pulse is allowed to read customer feedback from. Only a designated source is ever read, never a whole Slack workspace, so channel
// chatter cannot leak in. Today a source is a Slack channel; each has a weighted channel its messages count as, and a mode: `keep` (messages count at once) or
// `review` (they wait in the Signals list for a person to keep or dismiss). Reading is polled by the hourly job, or on demand with "Check now". A failed read is
// kept on the source as its last error and never thrown, so one broken channel cannot stop the others or the reminders.
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'
import { cleanChannel, SlackError, type SlackClient, type SlackMessage } from './slack.js'
import { type Channel } from './pulse-topics.js'

export type SourceMode = 'keep' | 'review'
export type Source = {
  id: string
  kind: 'slack'
  name: string
  channel: Channel
  mode: SourceMode
  enabled: boolean
  lastCheckedAt: string | null
  lastAdded: number | null
  lastError: string | null
}
export class SourceNotFound extends Error {}
export class BadSource extends Error {}

const FIRST_LOOK_DAYS = 30
const PAGE = 200
const MIN_LENGTH = 12

const toSource = (r: Record<string, any>): Source => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  channel: r.channel,
  mode: r.mode,
  enabled: r.enabled,
  lastCheckedAt: r.last_checked_at ? new Date(r.last_checked_at).toISOString() : null,
  lastAdded: r.last_added ?? null,
  lastError: r.last_error ?? null,
})
const SELECT = `select id, kind, name, channel, mode, enabled, last_checked_at, last_added, last_error from core.pulse_sources`

export async function listSources(db: Queryable, ctx: RequestContext): Promise<Source[]> {
  return (await db.query(`${SELECT} where workspace_id = $1 order by created_at, name`, [ctx.workspaceId])).rows.map(toSource)
}

const audit = (db: Queryable, ctx: RequestContext, verb: string, source: { id: string | null; name: string; mode?: string }) =>
  insertMany(db, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.pulse_sources', entity_id: source.id, verb, after: { source: source.name, ...(source.mode ? { mode: source.mode } : {}) } }])

/** Designates a Slack channel. With Slack connected the channel must exist (and the app be in it, for a private one); without a connection it is saved and checked once Slack is connected. */
export async function addSource(db: Db, ctx: RequestContext, slack: SlackClient, input: { name: string; channel?: Channel; mode?: SourceMode }): Promise<Source> {
  const name = cleanChannel(input.name)
  if (!name) throw new BadSource('A Slack channel name uses lower-case letters, numbers, dashes and underscores, for example customer-feedback.')
  let ref: string | null = null
  if (slack.reads ?? slack.live) {
    try {
      ref = await slack.findChannel(name)
    } catch (err) {
      throw new BadSource(err instanceof SlackError ? err.message : 'Slack could not be reached. Try again.')
    }
  }
  return db.transaction(async (tx) => {
    const dup = (await tx.query(`select 1 from core.pulse_sources where workspace_id = $1 and kind = 'slack' and name = $2`, [ctx.workspaceId, name])).rows[0]
    if (dup) throw new BadSource('That channel is already a source.')
    const row = (
      await tx.query(`insert into core.pulse_sources (workspace_id, kind, name, ref, channel, mode, created_by) values ($1, 'slack', $2, $3, $4, $5, $6) returning id`, [ctx.workspaceId, name, ref, input.channel ?? 'slack', input.mode ?? 'review', ctx.userId])
    ).rows[0]
    await audit(tx, ctx, 'added', { id: row.id, name, mode: input.mode ?? 'review' })
    return toSource((await tx.query(`${SELECT} where id = $1`, [row.id])).rows[0])
  })
}

export async function updateSource(db: Db, ctx: RequestContext, id: string, patch: { channel?: Channel; mode?: SourceMode; enabled?: boolean }): Promise<Source> {
  return db.transaction(async (tx) => {
    const found = (await tx.query(`select name from core.pulse_sources where id = $1 and workspace_id = $2`, [id, ctx.workspaceId])).rows[0]
    if (!found) throw new SourceNotFound()
    await tx.query(`update core.pulse_sources set channel = coalesce($2, channel), mode = coalesce($3, mode), enabled = coalesce($4, enabled) where id = $1`, [id, patch.channel ?? null, patch.mode ?? null, patch.enabled ?? null])
    await audit(tx, ctx, 'changed', { id, name: found.name, mode: patch.mode })
    return toSource((await tx.query(`${SELECT} where id = $1`, [id])).rows[0])
  })
}

/** Stops reading a channel. Signals already read stay (they were judged or are waiting to be). */
export async function removeSource(db: Db, ctx: RequestContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const found = (await tx.query(`delete from core.pulse_sources where id = $1 and workspace_id = $2 returning name`, [id, ctx.workspaceId])).rows[0]
    if (!found) throw new SourceNotFound()
    await audit(tx, ctx, 'removed', { id: null, name: found.name })
  })
}

/** Slack's markup as plain words: mentions and channel links dropped, links shown by their label, entities unescaped. */
export function plainSlackText(text: string): string {
  return text
    .replace(/<@[A-Z0-9]+(?:\|[^>]*)?>/g, '')
    .replace(/<!(?:here|channel|everyone)[^>]*>/g, '')
    .replace(/<#[A-Z0-9]+\|([^>]*)>/g, '#$1')
    .replace(/<(?:https?:\/\/|mailto:)[^|>]*\|([^>]*)>/g, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^>]*)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A message worth keeping as a signal: written by a person (not a bot, a join or a topic change), with some words to it. */
export function usableMessage(m: SlackMessage): string | null {
  if (m.bot || m.subtype) return null
  const body = plainSlackText(m.text)
  return body.length >= MIN_LENGTH ? body.slice(0, 4000) : null
}

type Row = { id: string; name: string; ref: string | null; channel: Channel; mode: SourceMode; cursor_ts: string | null }

async function readSource(db: Db, who: { workspaceId: string; userId: string | null }, slack: SlackClient, src: Row, now: Date): Promise<{ added: number; error: string | null }> {
  let added = 0
  let error: string | null = null
  let cursor = src.cursor_ts
  let ref = src.ref
  try {
    if (!(slack.reads ?? slack.live)) throw new SlackError('not_authed')
    ref = ref ?? (await slack.findChannel(src.name))
    let oldest = cursor ?? String(Math.floor(now.getTime() / 1000) - FIRST_LOOK_DAYS * 86400)
    for (let page = 0; page < 5; page++) {
      const messages = await slack.history(ref, oldest, PAGE)
      if (!messages.length) break
      const rows = messages.flatMap((m) => {
        const body = usableMessage(m)
        if (!body) return []
        const kept = src.mode === 'keep'
        return [{ workspace_id: who.workspaceId, body, kind: 'other', channel: src.channel, source: 'slack', source_label: `#${src.name}`, occurred_on: new Date(Number(m.ts) * 1000).toISOString().slice(0, 10), status: kept ? 'kept' : 'new', kept_at: kept ? now.toISOString() : null, external_id: `${ref}:${m.ts}` }]
      })
      if (rows.length) {
        const made = await db.query(
          `insert into core.pulse_signals (workspace_id, body, kind, channel, source, source_label, occurred_on, status, kept_at, external_id)
           select workspace_id, body, kind, channel, source, source_label, occurred_on::date, status, kept_at::timestamptz, external_id from jsonb_to_recordset($1::jsonb) as t(workspace_id uuid, body text, kind text, channel text, source text, source_label text, occurred_on text, status text, kept_at text, external_id text)
           on conflict (workspace_id, source, external_id) where external_id is not null do nothing returning id`,
          [JSON.stringify(rows)],
        )
        added += made.rows.length
      }
      cursor = messages[messages.length - 1].ts
      oldest = cursor
      if (messages.length < PAGE) break
    }
  } catch (err) {
    error = err instanceof SlackError ? (err.code === 'not_authed' || err.code === 'invalid_auth' ? 'Slack is not connected yet.' : err.message) : 'Slack could not be reached.'
    if (!(err instanceof SlackError)) console.error('pulse source read failed', err instanceof Error ? err.name : 'error')
  }
  await db.query(`update core.pulse_sources set ref = $2, cursor_ts = $3, last_checked_at = now(), last_added = $4, last_error = $5 where id = $1`, [src.id, ref, cursor, error ? null : added, error])
  return { added, error }
}

/** Reads one source now. Returns what was added and any problem, never throws for a Slack problem. */
export async function checkSource(db: Db, who: { workspaceId: string; userId: string | null }, slack: SlackClient, id: string, now: Date = new Date()): Promise<{ added: number; error: string | null }> {
  const src = (await db.query(`select id, name, ref, channel, mode, cursor_ts from core.pulse_sources where id = $1 and workspace_id = $2`, [id, who.workspaceId])).rows[0] as Row | undefined
  if (!src) throw new SourceNotFound()
  return readSource(db, who, slack, src, now)
}

/** Every enabled source of a workspace, for the hourly job. */
export async function checkAllSources(db: Db, who: { workspaceId: string; userId: string | null }, slack: SlackClient, now: Date = new Date()): Promise<{ sources: number; added: number }> {
  const rows = (await db.query(`select id, name, ref, channel, mode, cursor_ts from core.pulse_sources where workspace_id = $1 and enabled order by created_at`, [who.workspaceId])).rows as Row[]
  let added = 0
  for (const src of rows) added += (await readSource(db, who, slack, src, now)).added
  return { sources: rows.length, added }
}

