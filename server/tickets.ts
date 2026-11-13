// The Jira hand-off: a requirement becomes a ticket, and what was sent is kept (who, when, exactly what). With the Jira connection set (server/jira.ts)
// the ticket is made in Jira and keeps Jira's own key and link (KAN-1); without it the hand-off is simulated and the key is made here, in the
// project's own sequence (PLAT-215, PLAT-216 ...). Open questions are decisions, not tickets.
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import type { Jira } from './jira.js'

export type Ticket = {
  id: string
  storyId: string | null
  storyKey: string
  jiraKey: string
  project: string
  issueType: string
  summary: string
  description: string
  priority: string
  assignee: string
  labels: string
  points: string | null
  simulated: boolean
  jiraUrl: string | null
  createdBy: { id: string; name: string } | null
  createdAt: string
}
export type TicketInput = { project?: string; assigneeId?: string | null; issueType: string; summary: string; description: string; priority: string; assignee: string; labels: string; points: string | null }

/** The story already has a ticket. */
export class AlreadySent extends Error {
  constructor(public jiraKey: string) {
    super(`Already sent as ${jiraKey}.`)
  }
}
/** An open question is a decision to make, not work to hand over. */
export class NotTicketable extends Error {}
export class NoStory extends Error {}
/** The issue was made in Jira but could not be recorded here. */
export class RecordFailed extends Error {
  constructor(public jiraKey: string, detail: string) {
    super(`${jiraKey} was created in Jira but could not be recorded here (${detail}).`)
  }
}

const FIRST_NUMBER = 214 // the first simulated ticket of a project is 215

const TICKET_SQL = `
  select t.id, t.story_id, t.story_key, t.jira_key, t.project, t.issue_type, t.summary, t.description, t.priority, t.assignee, t.labels, t.points,
         t.simulated, t.jira_url, t.created_by, u.display_name as created_by_name, t.created_at
  from delivery.story_tickets t left join core.users u on u.id = t.created_by`

const toTicket = (r: Record<string, any>): Ticket => ({
  id: r.id, storyId: r.story_id ?? null, storyKey: r.story_key, jiraKey: r.jira_key, project: r.project, issueType: r.issue_type, summary: r.summary,
  description: r.description, priority: r.priority, assignee: r.assignee, labels: r.labels, points: r.points ?? null, simulated: !!r.simulated, jiraUrl: r.jira_url ?? null,
  createdBy: r.created_by ? { id: r.created_by, name: r.created_by_name ?? 'Someone' } : null, createdAt: new Date(r.created_at).toISOString(),
})

/** Every ticket made from a project's requirements documents, newest first. */
export async function listTickets(db: Queryable, workspaceId: string, projectId: string): Promise<Ticket[]> {
  const rows = (
    await db.query(`${TICKET_SQL} join delivery.specs s on s.id = t.spec_id where t.workspace_id = $1 and s.project_id = $2 order by t.created_at desc, t.jira_key desc`, [workspaceId, projectId])
  ).rows
  return rows.map(toTicket)
}

/** The story's checks: it exists, it is a requirement, and it has no ticket yet. */
async function checkStory(q: Queryable, ctx: RequestContext, storyId: string, lock = false) {
  const story = (await q.query(`select id, spec_id, key, kind from delivery.stories where id = $1 and workspace_id = $2${lock ? ' for update' : ''}`, [storyId, ctx.workspaceId])).rows[0]
  if (!story) throw new NoStory()
  if (story.kind !== 'requirement') throw new NotTicketable()
  const sent = (await q.query(`select jira_key from delivery.story_tickets where story_id = $1`, [storyId])).rows[0]
  if (sent) throw new AlreadySent(sent.jira_key)
  return story
}

const audit = (tx: Queryable, ctx: RequestContext, ticket: Ticket) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'delivery.story_tickets', $3, 'created', null, $4)`, [
    ctx.workspaceId, ctx.userId, ticket.id, JSON.stringify({ jiraKey: ticket.jiraKey, storyKey: ticket.storyKey, simulated: ticket.simulated, ...(ticket.jiraUrl ? { jiraUrl: ticket.jiraUrl } : {}) }),
  ])

/**
 * Makes the ticket for one story, once. With a Jira connection the issue is made in Jira first (outside any transaction, so a slow Jira holds
 * nothing open) and its key and link are kept; without one the key follows the project's own sequence here.
 */
export async function createTicket(db: Db, ctx: RequestContext, storyId: string, input: TicketInput, jira?: Jira | null): Promise<Ticket> {
  if (jira) {
    await checkStory(db, ctx, storyId)
    const issue = await jira.create({ issueType: input.issueType, summary: input.summary, description: input.description, priority: input.priority, labels: input.labels, assigneeId: input.assigneeId ?? null })
    // The issue now exists in Jira; keeping the record is all that is left, so a failure here says which issue it was.
    try {
      return await db.transaction(async (tx) => {
        const story = await checkStory(tx, ctx, storyId, true)
        const made = (
          await tx.query(
            `insert into delivery.story_tickets (workspace_id, spec_id, story_id, story_key, jira_key, project, issue_type, summary, description, priority, assignee, labels, points, simulated, jira_url, created_by)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, null, false, $13, $14) returning id`,
            [ctx.workspaceId, story.spec_id, storyId, story.key, issue.key, issue.project, input.issueType, input.summary, input.description, input.priority, input.assignee, input.labels, issue.url, ctx.userId],
          )
        ).rows[0]
        const ticket = toTicket((await tx.query(`${TICKET_SQL} where t.id = $1`, [made.id])).rows[0])
        await audit(tx, ctx, ticket)
        return ticket
      })
    } catch (err) {
      if (err instanceof AlreadySent || err instanceof NoStory || err instanceof NotTicketable) throw new RecordFailed(issue.key, err.message)
      throw new RecordFailed(issue.key, err instanceof Error ? err.message : 'unknown')
    }
  }
  return db.transaction(async (tx) => {
    const story = await checkStory(tx, ctx, storyId, true)
    const project = input.project || 'PLAT · Platform'
    const code = project.split(' · ')[0]
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`story-tickets:${ctx.workspaceId}:${code}`])
    const last = (await tx.query(`select coalesce(max((regexp_match(jira_key, '-([0-9]+)$'))[1]::int), $3::int) as n from delivery.story_tickets where workspace_id = $1 and jira_key like $2`, [ctx.workspaceId, `${code}-%`, FIRST_NUMBER])).rows[0].n
    const made = (
      await tx.query(
        `insert into delivery.story_tickets (workspace_id, spec_id, story_id, story_key, jira_key, project, issue_type, summary, description, priority, assignee, labels, points, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
        [ctx.workspaceId, story.spec_id, storyId, story.key, `${code}-${Number(last) + 1}`, project, input.issueType, input.summary, input.description, input.priority, input.assignee, input.labels, input.points, ctx.userId],
      )
    ).rows[0]
    const ticket = toTicket((await tx.query(`${TICKET_SQL} where t.id = $1`, [made.id])).rows[0])
    await audit(tx, ctx, ticket)
    return ticket
  })
}
