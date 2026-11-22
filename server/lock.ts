// The lock on a research project once its requirements are published. From then on the project's transcripts, analysis, themes and requirements do not change:
// approvers have been asked about this brief, and engineers may start from the tickets. Stories, Jira tickets, launch notes and answers stay open. Changes after
// this happen in a new project.
//
// The lock can be lifted, by returning the requirements to draft, only by a workspace owner or the launch's final approver, and only while no Jira ticket has
// been made for real (a simulated ticket pushes nothing, so it does not count). The first real ticket locks it for good.
import { T } from '../shared/terms.mjs'
import type { RequestContext } from './context.js'
import type { Queryable } from './db.js'
import { ApiError } from './errors.js'
import { reviewersFor } from '../shared/launch.mjs'

export type ProjectLock = {
  locked: boolean
  /** A Jira ticket exists: the requirements can no longer be returned to draft by anyone. */
  permanent: boolean
  specId: string | null
  publishedAt: string | null
}

export const LOCK_MESSAGE =
  `The requirements are published, so this project is locked. Changes from here happen in a new project. A workspace owner or the final ${T.approver} can return the requirements to draft until the first Jira ticket is created.`
export const DELETE_MESSAGE = `This project is locked because its requirements are published, so it cannot be deleted. A workspace owner or the final ${T.approver} can return the requirements to draft until the first Jira ticket is created.`
export const DELETE_PERMANENT_MESSAGE = 'This project is locked for good (its requirements are published and Jira tickets exist), so it cannot be deleted.'
export const PERMANENT_LOCK_MESSAGE = 'The requirements are published and Jira tickets have been created, so this project is locked for good. Changes from here happen in a new project.'

export async function projectLock(db: Queryable, projectId: string): Promise<ProjectLock> {
  const spec = (
    await db.query(
      `select s.id, s.published_at from delivery.specs s join core.projects p on p.id = s.project_id
        where s.project_id = $1 and s.status = 'published' and p.kind = 'research' order by s.published_at desc limit 1`,
      [projectId],
    )
  ).rows[0]
  if (!spec) return { locked: false, permanent: false, specId: null, publishedAt: null }
  const ticketed = (
    await db.query(
      `select 1 from delivery.story_tickets t join delivery.specs s on s.id = t.spec_id where s.project_id = $1 and coalesce(t.simulated, false) = false limit 1`,
      [projectId],
    )
  ).rows[0]
  return { locked: true, permanent: !!ticketed, specId: spec.id as string, publishedAt: new Date(spec.published_at).toISOString() }
}

/** Refuses (409 project_locked) when the project's requirements are published. */
export async function assertUnlocked(db: Queryable, projectId: string, action: 'change' | 'delete' = 'change'): Promise<void> {
  const lock = await projectLock(db, projectId)
  if (!lock.locked) return
  if (action === 'delete') throw new ApiError(409, 'project_locked', lock.permanent ? DELETE_PERMANENT_MESSAGE : DELETE_MESSAGE)
  throw new ApiError(409, 'project_locked', lock.permanent ? PERMANENT_LOCK_MESSAGE : LOCK_MESSAGE)
}

/** The project a theme belongs to (so a theme edit can be refused when that project is locked). */
export async function projectOfTheme(db: Queryable, themeId: string): Promise<string | null> {
  return ((await db.query(`select project_id from research.themes where id = $1`, [themeId])).rows[0]?.project_id as string | undefined) ?? null
}

/** Who may return published requirements to draft: a workspace owner, or the final approver for the project's team (primary or backup, as set under Settings). */
export async function mayReopen(db: Queryable, ctx: RequestContext, projectId: string): Promise<boolean> {
  if (ctx.role === 'owner' && !ctx.anonymous) return true
  const team = (await db.query(`select team_id from core.projects where id = $1`, [projectId])).rows[0]?.team_id as string | null | undefined
  if (!team) return false
  const rows = (await db.query(`select user_id, team_id, role from core.reviewer_assignments where workspace_id = $1 and step = 'final_decision'`, [ctx.workspaceId])).rows
  const who = reviewersFor(
    rows.map((r) => ({ userId: r.user_id as string, step: 'final_decision', teamId: (r.team_id as string | null) ?? null, role: r.role as 'primary' | 'alternate', unavailable: false })),
    team,
    'final_decision',
  )
  return [...who.primary, ...who.alternate].some((id: string) => id === ctx.userId)
}
