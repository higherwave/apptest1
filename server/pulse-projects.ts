// Pulse to Signal Flow: topic details (the quotes and accounts behind a topic), suggested research questions, and starting a Signal Flow project from the chosen topics with its
// Test Plan filled in. Owners only while Pulse is a preview (pulse.ts, `pulseOn`); every route asks that first.
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { getWeights, listTopics, opportunityOf, type Opportunity, type Topic } from './pulse.js'
import { suggestQuestions, type Channel, type Suggested } from './pulse-topics.js'
import { createProjectIn } from './projects.js'
import { insertMany } from './sql.js'
import { arrByName, normalizeAccount } from './pulse-accounts.js'

export class UnknownTopic extends Error {}

export type Quote = { id: string; body: string; kind: string; channel: Channel; sourceLabel: string | null; sourceUrl: string | null; saidBy: string | null; account: string | null; occurredOn: string | null; opportunity: Opportunity | null }
export type TopicDetail = Topic & {
  quotes: Quote[]
  accounts: { name: string; signals: number; arr: number | null }[]
  people: { name: string; signals: number }[]
}

const QUOTES = `select s.id, s.body, s.kind, s.channel, s.source_label, s.source_url, s.said_by, s.account, to_char(s.occurred_on, 'YYYY-MM-DD') as occurred_on, s.created_at,
  s.opp_id, s.opp_name, s.opp_amount, s.opp_stage, to_char(s.opp_close_date, 'YYYY-MM-DD') as opp_close_date, s.opp_state
  from core.pulse_topic_signals ts join core.pulse_signals s on s.id = ts.signal_id where ts.workspace_id = $1 and ts.topic_id = any($2::uuid[]) and s.status = 'kept'
  order by coalesce(s.occurred_on, s.created_at::date) desc, s.created_at desc, s.id`

const toQuote = (r: Record<string, any>): Quote => ({ id: r.id, body: r.body, kind: r.kind, channel: r.channel, sourceLabel: r.source_label ?? null, sourceUrl: r.source_url ?? null, saidBy: r.said_by ?? null, account: r.account ?? null, occurredOn: r.occurred_on ?? null, opportunity: opportunityOf(r) })

const tally = (names: (string | null)[]) => {
  const m = new Map<string, { name: string; signals: number }>()
  for (const n of names) {
    const name = n?.trim()
    if (!name || /^unknown$/i.test(name)) continue
    const k = name.toLowerCase()
    m.set(k, { name: m.get(k)?.name ?? name, signals: (m.get(k)?.signals ?? 0) + 1 })
  }
  return [...m.values()].sort((a, b) => b.signals - a.signals || a.name.localeCompare(b.name))
}

export async function topicDetail(db: Queryable, ctx: RequestContext, id: string): Promise<TopicDetail | null> {
  const topic = (await listTopics(db, ctx)).topics.find((t) => t.id === id)
  if (!topic) return null
  const rows = (await db.query(QUOTES, [ctx.workspaceId, [id]])).rows
  const known = await arrByName(db, ctx.workspaceId)
  const accounts = tally(rows.map((r) => r.account)).map((a) => ({ ...a, arr: known.get(normalizeAccount(a.name))?.arr ?? null }))
  return { ...topic, quotes: rows.map(toQuote), accounts, people: tally(rows.map((r) => r.said_by)) }
}

/** Suggested questions for the chosen topics (in the order given), worked out from their own signals. */
export async function suggestFor(db: Queryable, ctx: RequestContext, topicIds: string[], method: string): Promise<Suggested[]> {
  const list = await listTopics(db, ctx)
  const chosen = topicIds.map((id) => list.topics.find((t) => t.id === id))
  if (chosen.some((t) => !t)) throw new UnknownTopic()
  const rows = (await db.query(QUOTES, [ctx.workspaceId, topicIds])).rows
  const topics = chosen.map((t) => ({ id: t!.id, title: t!.title, quotes: [] as { id: string; body: string; saidBy: string | null; channel: Channel; at: string }[] }))
  const topicOf = new Map(((await db.query(`select signal_id, topic_id from core.pulse_topic_signals where workspace_id = $1 and topic_id = any($2::uuid[])`, [ctx.workspaceId, topicIds])).rows).map((r) => [r.signal_id as string, r.topic_id as string]))
  for (const r of rows) topics.find((t) => t.id === topicOf.get(r.id))?.quotes.push({ id: r.id, body: r.body, saidBy: r.said_by ?? null, channel: r.channel, at: r.occurred_on ?? new Date(r.created_at).toISOString() })
  return suggestQuestions(topics, method, await getWeights(db, ctx.workspaceId))
}

export type NewPulseProject = { name: string; description: string | null; methods: string[]; topicIds: string[]; questions: { prompt: string; topicId: string | null }[]; teamId?: string }

/**
 * Makes the Signal Flow project (its Test Plan: the description under "What to test", the methods, and the questions under "What to ask or observe") and records which topics it
 * started from, all or nothing. Participants are not added: a person has to choose who to invite, and Pulse has no email addresses.
 */
export async function createProjectFromTopics(db: Db, ctx: RequestContext, input: NewPulseProject): Promise<string> {
  const list = await listTopics(db, ctx)
  const chosen = input.topicIds.map((id) => list.topics.find((t) => t.id === id))
  if (!chosen.length || chosen.some((t) => !t)) throw new UnknownTopic()
  return db.transaction(async (tx) => {
    const projectId = await createProjectIn(tx, { workspaceId: ctx.workspaceId, userId: ctx.userId, teamId: input.teamId }, { name: input.name, templateKey: 'blank', methods: input.methods as never, description: input.description, participants: [] })
    // The blank template's starter questions are replaced by the chosen ones.
    await tx.query(`delete from research.tasks where project_id = $1`, [projectId])
    for (const [i, q] of input.questions.entries()) {
      await tx.query(`insert into research.tasks (workspace_id, project_id, position, prompt, created_by, updated_by) values ($1, $2, $3, $4, $5, $5)`, [ctx.workspaceId, projectId, i, q.prompt, ctx.userId])
    }
    await insertMany(tx, 'core.pulse_project_links', chosen.map((t) => ({ workspace_id: ctx.workspaceId, project_id: projectId, topic_id: t!.id, topic_title: t!.title, signal_count: t!.signals, created_by: ctx.userId })))
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.pulse_project_links', entity_id: projectId, verb: 'started a project from topics', after: { topics: chosen.map((t) => t!.title), signals: chosen.reduce((a, t) => a + t!.signals, 0) } }])
    return projectId
  })
}

export type Origin = { topics: { id: string | null; title: string }[]; signals: number }

/** Where a project came from, if it was started from Pulse topics; null otherwise. */
export async function originOf(db: Queryable, ctx: RequestContext, projectId: string): Promise<Origin | null> {
  const rows = (await db.query(`select topic_id, topic_title, signal_count from core.pulse_project_links where workspace_id = $1 and project_id = $2 order by created_at, topic_title`, [ctx.workspaceId, projectId])).rows
  if (!rows.length) return null
  return { topics: rows.map((r) => ({ id: r.topic_id ?? null, title: r.topic_title })), signals: rows.reduce((a, r) => a + Number(r.signal_count), 0) }
}
