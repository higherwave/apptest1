// The admin audit log: what changed in the workspace, and who changed it. It reads core.audit_log, which the rest of the server already
// writes to; only the kinds of change an administrator cares about are shown (people and roles, experience categories, projects,
// workflows, Jira hand-offs), not every internal step.
import type { Queryable } from './db.js'

export const AUDIT_GROUPS = {
  members: ['core.memberships'],
  teams: ['core.teams', 'core.team_memberships'],
  reviewers: ['core.reviewer_assignments', 'core.team_launch_steps'],
  categories: ['insights.feature_areas'],
  projects: ['core.projects'],
  workflows: ['insights.workflows'],
  jira: ['delivery.story_tickets'],
} as const
export type AuditGroup = keyof typeof AUDIT_GROUPS

export type AuditEntry = {
  id: string
  createdAt: string
  actor: { id: string; name: string } | null
  group: AuditGroup
  entity: string
  entityId: string | null
  /** The team the change was about: a project's team, or the team itself. */
  team: { id: string; name: string } | null
  verb: string
  before: unknown
  after: unknown
}
export type AuditPage = { data: AuditEntry[]; nextCursor: string | null }

const groupOf = (entity: string): AuditGroup => (Object.entries(AUDIT_GROUPS).find(([, list]) => (list as readonly string[]).includes(entity))?.[0] ?? 'projects') as AuditGroup
const CURSOR = /^[0-9:. +\-TZ]+\|[0-9a-f-]{36}$/i

export class BadCursor extends Error {}

/** Newest first, a page at a time. The cursor is the last row's timestamp and id, so a page never repeats or skips a row. */
export async function listAudit(db: Queryable, workspaceId: string, opts: { group?: AuditGroup; teamId?: string; limit: number; cursor?: string }): Promise<AuditPage> {
  const entities: string[] = opts.group ? [...AUDIT_GROUPS[opts.group]] : Object.values(AUDIT_GROUPS).flatMap((l) => [...l])
  const params: unknown[] = [workspaceId, entities]
  let after = ''
  if (opts.cursor) {
    if (!CURSOR.test(opts.cursor)) throw new BadCursor()
    const [ts, id] = opts.cursor.split('|')
    params.push(ts, id)
    after = `and (a.created_at, a.id) < ($3::timestamptz, $4::uuid)`
  }
  // A change is about a team when it is the team (or someone's place in it), or a project that belongs to it (a moved project counts for the team it went to).
  let about = ''
  if (opts.teamId) {
    params.push(opts.teamId)
    about = `and coalesce(t.id, p.team_id) = $${params.length}::uuid`
  }
  params.push(opts.limit + 1)
  const rows = (
    await db.query(
      `select a.id, a.created_at::text as ts, a.actor_id, u.display_name, a.entity, a.entity_id, a.verb, a.before, a.after, tm.id as team_id, tm.name as team_name
       from core.audit_log a
       left join core.users u on u.id = a.actor_id
       left join core.teams t on t.id = a.entity_id and a.entity in ('core.teams', 'core.team_memberships')
       left join core.projects p on p.id = a.entity_id and a.entity in ('core.projects', 'core.teams')
       left join core.teams tm on tm.id = coalesce(t.id, p.team_id)
       where a.workspace_id = $1 and a.entity = any($2::text[]) ${after} ${about}
       order by a.created_at desc, a.id desc limit $${params.length}`,
      params,
    )
  ).rows
  const page = rows.slice(0, opts.limit)
  const last = page[page.length - 1]
  return {
    data: page.map((r) => ({
      id: r.id,
      createdAt: new Date(r.ts).toISOString(),
      actor: r.actor_id ? { id: r.actor_id, name: r.display_name ?? 'Someone' } : null,
      group: groupOf(r.entity),
      entity: r.entity,
      entityId: r.entity_id ?? null,
      team: r.team_id ? { id: r.team_id, name: r.team_name } : null,
      verb: r.verb,
      before: r.before ?? null,
      after: r.after ?? null,
    })),
    nextCursor: rows.length > opts.limit && last ? `${last.ts}|${last.id}` : null,
  }
}
