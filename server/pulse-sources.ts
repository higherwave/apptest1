// Pulse sources: the places Pulse is allowed to read customer feedback from. Only a designated source is ever read, never a whole Slack workspace, so channel
// chatter cannot leak in. A source is a Slack channel, or the notes on Salesforce opportunities (the fields an owner names); each has a weighted channel its messages count as, and a mode: `keep` (messages count at once) or
// `review` (they wait in the Signals list for a person to keep or dismiss). Reading is polled by the hourly job, or on demand with "Check now". A failed read is
// kept on the source as its last error and never thrown, so one broken channel cannot stop the others or the reminders.
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'
import { cleanChannel, SlackError, type SlackClient, type SlackMessage } from './slack.js'
import { isFieldName, MAX_NOTE_FIELDS, SalesforceError, type OpportunityScope, type SalesforceClient } from './salesforce.js'
import { type Channel } from './pulse-topics.js'
import { isRepeat, loadKnownIds, loadSeen } from './pulse-clean.js'

export type SourceMode = 'keep' | 'review'
export type Source = {
  id: string
  kind: 'slack' | 'salesforce_opportunity'
  name: string
  channel: Channel
  mode: SourceMode
  enabled: boolean
  lastCheckedAt: string | null
  lastAdded: number | null
  lastError: string | null
  /** For opportunity notes: which fields are read, from which opportunities, and the amount field. Null for a Slack channel. */
  config: OpportunityConfig | null
}
export type OpportunityConfig = { fields: string[]; scope: OpportunityScope; amountField: string }
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
  config: r.kind === 'salesforce_opportunity' ? (r.config as OpportunityConfig) : null,
})
const SELECT = `select id, kind, name, channel, mode, enabled, last_checked_at, last_added, last_error, config from core.pulse_sources`

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
    await audit(tx, ctx, 'added', { id: row.id, name, mode: input.mode ?? 'keep' })
    return toSource((await tx.query(`${SELECT} where id = $1`, [row.id])).rows[0])
  })
}

/** Designates the notes on Salesforce opportunities as a source (one per workspace): the named fields of open and recently lost opportunities. Needs the read-only Salesforce connection to read, not to be saved. */
export async function addOpportunitySource(db: Db, ctx: RequestContext, input: { fields: string[]; scope?: OpportunityScope; amountField?: string; mode?: SourceMode; channel?: Channel }): Promise<Source> {
  const fields = [...new Set(input.fields.map((f) => f.trim()).filter(Boolean))]
  const amountField = (input.amountField ?? 'Amount').trim()
  if (!fields.length || fields.length > MAX_NOTE_FIELDS || !fields.every(isFieldName) || !isFieldName(amountField)) throw new BadSource('Name up to five fields by their API names, such as NextStep or Loss_Reason__c.')
  const config: OpportunityConfig = { fields, scope: input.scope ?? 'both', amountField }
  return db.transaction(async (tx) => {
    const dup = (await tx.query(`select 1 from core.pulse_sources where workspace_id = $1 and kind = 'salesforce_opportunity'`, [ctx.workspaceId])).rows[0]
    if (dup) throw new BadSource('Opportunity notes are already a source. Change or remove it instead.')
    const row = (
      await tx.query(`insert into core.pulse_sources (workspace_id, kind, name, channel, mode, config, created_by) values ($1, 'salesforce_opportunity', 'opportunities', $2, $3, $4::jsonb, $5) returning id`, [ctx.workspaceId, input.channel ?? 'salesforce', input.mode ?? 'review', JSON.stringify(config), ctx.userId])
    ).rows[0]
    await audit(tx, ctx, 'added', { id: row.id, name: 'Salesforce opportunity notes', mode: input.mode ?? 'keep' })
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

type Row = { id: string; kind: Source['kind']; name: string; ref: string | null; channel: Channel; mode: SourceMode; cursor_ts: string | null; config: OpportunityConfig | null }
type Who = { workspaceId: string; userId: string | null }
/** The connections a read may use; a missing one makes that kind of source say it is not connected. */
export type Clients = { slack?: SlackClient | null; salesforce?: SalesforceClient | null }

async function readSlack(db: Db, who: Who, slack: SlackClient, src: Row, now: Date): Promise<{ added: number; error: string | null; duplicates: number }> {
  let added = 0
  let duplicates = 0
  const seen = await loadSeen(db, who.workspaceId)
  const known = await loadKnownIds(db, who.workspaceId, 'slack')
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
        if (!body || known.has(`${ref}:${m.ts}`)) return []
        if (isRepeat(body, seen)) {
          duplicates++
          return []
        }
        const kept = true // nothing waits for review: every signal counts at once, and a person dismisses a topic instead
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
  return { added, error, duplicates }
}

// Salesforce times come as "2026-11-20T10:00:00.000+0000"; SOQL wants "2026-11-20T10:00:00Z".
const sfDate = (s: string) => new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'))
const soqlTime = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z')
const FIRST_LOOK_OPP_DAYS = 90

async function updateOpportunityFacts(db: Db, workspaceId: string, opps: { id: string; name: string; amount: number | null; stage: string | null; closeDate: string | null; state: string }[]) {
  if (!opps.length) return
  await db.query(
    `update core.pulse_signals s set opp_name = t.name, opp_amount = t.amount, opp_stage = t.stage, opp_close_date = nullif(t.close_date, '')::date, opp_state = t.state
       from jsonb_to_recordset($2::jsonb) as t(id text, name text, amount numeric, stage text, close_date text, state text)
      where s.workspace_id = $1 and s.source = 'salesforce' and s.opp_id = t.id`,
    [workspaceId, JSON.stringify(opps.map((o) => ({ id: o.id, name: o.name, amount: o.amount, stage: o.stage, close_date: o.closeDate ?? '', state: o.state })))],
  )
}

async function readOpportunities(db: Db, who: Who, sf: SalesforceClient | null | undefined, src: Row, now: Date): Promise<{ added: number; error: string | null; duplicates: number }> {
  let added = 0
  let duplicates = 0
  const seen = await loadSeen(db, who.workspaceId)
  const known = await loadKnownIds(db, who.workspaceId, 'salesforce')
  let error: string | null = null
  let cursor = src.cursor_ts
  try {
    if (!sf) throw new SalesforceError('not_connected')
    const cfg = src.config
    if (!cfg) throw new SalesforceError('INVALID_FIELD')
    const since = cursor ?? soqlTime(new Date(now.getTime() - FIRST_LOOK_OPP_DAYS * 86_400_000))
    const opps = await sf.fetchOpportunities({ fields: cfg.fields, scope: cfg.scope, amountField: cfg.amountField, since })
    const kept = true // nothing waits for review: every signal counts at once, and a person dismisses a topic instead
    const rows = opps.flatMap((o) =>
      cfg.fields.flatMap((f) => {
        const body = plainSlackText(o.notes[f] ?? '').slice(0, 4000)
        if (body.length < MIN_LENGTH || known.has(`${o.id}:${f}`)) return []
        // The same words on the same deal read again (a note copied into two fields) are one signal.
        if (isRepeat(body, seen)) {
          duplicates++
          return []
        }
        return [
          { workspace_id: who.workspaceId, body, kind: 'other', channel: src.channel, source: 'salesforce', source_label: `${o.name || 'Opportunity'} · ${f}`, account: o.accountName, account_sf_id: o.accountId, occurred_on: sfDate(o.modified).toISOString().slice(0, 10), status: kept ? 'kept' : 'new', kept_at: kept ? now.toISOString() : null, external_id: `${o.id}:${f}`, opp_id: o.id, opp_name: o.name, opp_amount: o.amount, opp_stage: o.stage, opp_close_date: o.closeDate ?? '', opp_state: o.state },
        ]
      }),
    )
    if (rows.length) {
      const made = await db.query(
        `insert into core.pulse_signals (workspace_id, body, kind, channel, source, source_label, account, account_sf_id, occurred_on, status, kept_at, external_id, opp_id, opp_name, opp_amount, opp_stage, opp_close_date, opp_state)
         select workspace_id, body, kind, channel, source, source_label, account, account_sf_id, occurred_on::date, status, kept_at::timestamptz, external_id, opp_id, opp_name, opp_amount, opp_stage, nullif(opp_close_date, '')::date, opp_state
           from jsonb_to_recordset($1::jsonb) as t(workspace_id uuid, body text, kind text, channel text, source text, source_label text, account text, account_sf_id text, occurred_on text, status text, kept_at text, external_id text, opp_id text, opp_name text, opp_amount numeric, opp_stage text, opp_close_date text, opp_state text)
         on conflict (workspace_id, source, external_id) where external_id is not null do nothing returning id`,
        [JSON.stringify(rows)],
      )
      added = made.rows.length
    }
    // What the opportunities say now: amount, stage, close date, and whether the deal is still open. Those just read, and any signal's opportunity still marked open.
    await updateOpportunityFacts(db, who.workspaceId, opps)
    const stale = (await db.query(`select distinct opp_id from core.pulse_signals where workspace_id = $1 and source = 'salesforce' and opp_state = 'open' and opp_id is not null limit 200`, [who.workspaceId])).rows.map((r) => r.opp_id as string).filter((id) => !opps.some((o) => o.id === id))
    if (stale.length) await updateOpportunityFacts(db, who.workspaceId, await sf.refreshOpportunities(stale, cfg.amountField))
    if (opps.length) cursor = soqlTime(new Date(sfDate(opps[opps.length - 1].modified).getTime() - 1000))
  } catch (err) {
    error = err instanceof SalesforceError ? err.message : 'Salesforce could not be reached.'
    if (!(err instanceof SalesforceError)) console.error('pulse opportunity read failed', err instanceof Error ? err.name : 'error')
  }
  await db.query(`update core.pulse_sources set cursor_ts = $2, last_checked_at = now(), last_added = $3, last_error = $4 where id = $1`, [src.id, cursor, error ? null : added, error])
  return { added, error, duplicates }
}

async function readSource(db: Db, who: Who, clients: Clients, src: Row, now: Date): Promise<{ added: number; error: string | null; duplicates: number }> {
  if (src.kind === 'salesforce_opportunity') return readOpportunities(db, who, clients.salesforce, src, now)
  if (!clients.slack) {
    await db.query(`update core.pulse_sources set last_checked_at = now(), last_added = null, last_error = 'Slack is not connected yet.' where id = $1`, [src.id])
    return { added: 0, error: 'Slack is not connected yet.', duplicates: 0 }
  }
  return readSlack(db, who, clients.slack, src, now)
}

const ROW = `select id, kind, name, ref, channel, mode, cursor_ts, config from core.pulse_sources`

/** Reads one source now. Returns what was added and any problem, never throws for a Slack or Salesforce problem. */
export async function checkSource(db: Db, who: Who, clients: Clients, id: string, now: Date = new Date()): Promise<{ added: number; error: string | null; duplicates: number }> {
  const src = (await db.query(`${ROW} where id = $1 and workspace_id = $2`, [id, who.workspaceId])).rows[0] as Row | undefined
  if (!src) throw new SourceNotFound()
  return readSource(db, who, clients, src, now)
}

/** Every enabled source of a workspace, for the hourly job. */
export async function checkAllSources(db: Db, who: Who, clients: Clients, now: Date = new Date()): Promise<{ sources: number; added: number }> {
  const rows = (await db.query(`${ROW} where workspace_id = $1 and enabled order by created_at`, [who.workspaceId])).rows as Row[]
  let added = 0
  for (const src of rows) added += (await readSource(db, who, clients, src, now)).added
  return { sources: rows.length, added }
}
