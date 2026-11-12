// Teams: who may see and change which projects.
//
//   - A team owns projects. A person has a role (owner, editor, viewer) in each team they belong to.
//   - A workspace owner is a leader: they see every team's projects, read-only in teams they are not a member of.
//   - The read-only demo viewer (no sign-in) sees everything, as before.
//   - Anyone else sees only the teams they belong to; a project of another team does not exist for them (404, never 403).
//
// context.ts loads a person's team roles with the rest of their identity; app.ts runs `enforceProjectScope` on every route that names a
// project, directly or through a theme, document, story or agent step. A test walks the API spec to prove every such route is covered.
import type { Queryable } from './db.js'
import { ApiError } from './errors.js'

export type Role = 'owner' | 'editor' | 'viewer'
/** A person's role in each team they belong to, by team id. */
export type TeamRoles = Record<string, Role>

/** What a request needs to know about its caller to scope data. */
export type Scope = { anonymous: boolean; workspaceId: string; role: Role; teams: TeamRoles }

export async function loadTeamRoles(db: Queryable, workspaceId: string, userId: string): Promise<TeamRoles> {
  const { rows } = await db.query(`select team_id, role from core.team_memberships where workspace_id = $1 and user_id = $2`, [workspaceId, userId])
  return Object.fromEntries(rows.map((r) => [r.team_id as string, r.role as Role]))
}

/**
 * The role used for everything that is not about one project (the Admin tabs, categories, notifications). A workspace owner is a leader and
 * keeps the owner role. Anyone else is an editor if they edit in any team, otherwise a viewer; a team's owner role is power inside that team only.
 */
export function effectiveRole(workspaceRole: Role, teams: TeamRoles): Role {
  if (workspaceRole === 'owner') return 'owner'
  return Object.values(teams).some((r) => r === 'editor' || r === 'owner') ? 'editor' : 'viewer'
}

/** Whether this caller sees every team (a leader, or the read-only demo viewer). */
export const seesAllTeams = (s: Pick<Scope, 'anonymous' | 'role'>) => s.anonymous || s.role === 'owner'

/** The teams a caller may see projects of, or null for all of them. */
export const visibleTeamIds = (s: Pick<Scope, 'anonymous' | 'role' | 'teams'>): string[] | null => (seesAllTeams(s) ? null : Object.keys(s.teams))

/** The teams a caller may add and change projects in. */
export const editableTeamIds = (s: Pick<Scope, 'teams'>): string[] => Object.entries(s.teams).filter(([, r]) => r === 'editor' || r === 'owner').map(([id]) => id)

/**
 * SQL for "this project is in a team the caller can see", for a query over core.projects aliased `alias`. Returns the condition and its parameters
 * (a uuid array), or an always-true condition when the caller sees every team.
 */
export function teamCondition(s: Pick<Scope, 'anonymous' | 'role' | 'teams'>, alias: string, paramIndex: number): { sql: string; params: unknown[] } {
  const ids = visibleTeamIds(s)
  if (ids === null) return { sql: 'true', params: [] }
  return { sql: `${alias}.team_id = any($${paramIndex}::uuid[])`, params: [ids] }
}

export type ProjectAccess = { role: Role; teamId: string | null }

/**
 * What the caller may do with one project: their role in its team, 'viewer' for a leader outside the team or the demo viewer, or null when the
 * project is another team's and not theirs to see. undefined when there is no such project (the route answers its own 404).
 */
export async function projectAccess(db: Queryable, s: Scope, projectId: string): Promise<ProjectAccess | null | undefined> {
  const { rows } = await db.query(`select team_id from core.projects where id = $1 and workspace_id = $2`, [projectId, s.workspaceId])
  if (!rows[0]) return undefined
  const teamId: string | null = rows[0].team_id ?? null
  const own = teamId ? s.teams[teamId] : undefined
  if (own && !s.anonymous) return { role: own, teamId }
  if (seesAllTeams(s)) return { role: 'viewer', teamId }
  return null
}

// The project a route is about, from the id in its path. Anything a route can name resolves to one project.
const OWNER_SQL: Record<string, string> = {
  theme: `select project_id from research.themes where id = $1 and workspace_id = $2`,
  spec: `select project_id from delivery.specs where id = $1 and workspace_id = $2`,
  story: `select sp.project_id from delivery.stories s join delivery.specs sp on sp.id = s.spec_id where s.id = $1 and s.workspace_id = $2`,
  step: `select r.project_id from core.agent_steps st join core.agent_runs r on r.id = st.run_id where st.id = $1 and st.workspace_id = $2`,
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The kind of thing a path names, with its id, or null when the path is not about a project. Paths come without the /api/v1 prefix. */
export function scopeOf(path: string): { kind: 'project' | 'theme' | 'spec' | 'story' | 'step'; id: string } | null {
  const m = /^\/(projects|themes|specs|stories|agent-steps)\/([^/]+)(?:\/|$)/.exec(path)
  if (!m || !UUID.test(m[2])) return null // /projects/new, /specs/standalone and the like name no project
  const kind = ({ projects: 'project', themes: 'theme', specs: 'spec', stories: 'story', 'agent-steps': 'step' } as const)[m[1] as 'projects']
  return { kind, id: m[2] }
}

/**
 * Throws 404 when the route names a project the caller may not see, and 403 when it changes a project they may only read. Routes that name no
 * project, and ids that match nothing (the route answers those itself), pass.
 */
export async function enforceProjectScope(db: Queryable, s: Scope, method: string, path: string): Promise<void> {
  const target = scopeOf(path)
  if (!target) return
  let projectId = target.id
  if (target.kind !== 'project') {
    const { rows } = await db.query(OWNER_SQL[target.kind], [target.id, s.workspaceId])
    if (!rows[0]) return
    projectId = rows[0].project_id
  }
  const access = await projectAccess(db, s, projectId)
  if (access === undefined) return
  if (access === null) throw new ApiError(404, 'not_found', 'No such project.')
  const reads = method === 'GET' || method === 'HEAD'
  if (!reads && access.role === 'viewer') throw new ApiError(403, 'forbidden', 'Your role in this team cannot make changes.')
}

/**
 * The team a new project goes to. A person may only add to a team they edit. With none named: their one editing team, or the workspace's
 * default team when they edit several and it is one of them, or a 422 asking them to choose.
 */
export async function newProjectTeam(db: Queryable, s: Scope, requested?: string): Promise<string> {
  const editable = editableTeamIds(s)
  if (requested) {
    if (!editable.includes(requested)) throw new ApiError(422, 'validation_failed', 'Choose a team you can add projects to.', 'teamId')
    return requested
  }
  if (editable.length === 0) throw new ApiError(403, 'forbidden', 'You are not an editor in any team.')
  if (editable.length === 1) return editable[0]
  const def = (await db.query(`select id from core.teams where workspace_id = $1 and is_default`, [s.workspaceId])).rows[0]?.id as string | undefined
  if (def && editable.includes(def)) return def
  throw new ApiError(422, 'validation_failed', 'Choose a team for the project.', 'teamId')
}
