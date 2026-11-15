// Managing teams: leaders (workspace owners) create and rename teams, say who is in each with what role, and move projects between them.
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import type { Role } from './teams.js'

export type TeamMember = { memberId: string; email: string; displayName: string; role: Role }
export type TeamProject = { id: string; name: string }
export type Team = { id: string; name: string; isDefault: boolean; slackChannel: string | null; members: TeamMember[]; projects: TeamProject[]; /** Steps this team uses that nobody approves (filled in by the route, from the approvals). */ gaps: number }

export class TeamNotFound extends Error {}
export class TeamNameTaken extends Error {}
export class TeamNotEmpty extends Error {}
export class TeamIsDefault extends Error {}
export class PersonNotInWorkspace extends Error {}
export class ProjectNotFound extends Error {}
/** People's places in a team other than the default come from sign-in groups, so they are not edited here. */
export class MembersManagedBySso extends Error {}

const audit = (tx: Queryable, ctx: RequestContext, entity: 'core.teams' | 'core.team_memberships', id: string, verb: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.workspaceId, ctx.userId, entity, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

/** Every team of the workspace with its people and its research projects, the default team first. */
export async function listTeams(db: Queryable, workspaceId: string): Promise<Team[]> {
  const teams = (await db.query(`select id, name, is_default, slack_channel from core.teams where workspace_id = $1 order by is_default desc, lower(name)`, [workspaceId])).rows
  const members = (
    await db.query(
      `select tm.team_id, m.id as member_id, u.email, u.display_name, tm.role
         from core.team_memberships tm
         join core.users u on u.id = tm.user_id
         join core.memberships m on m.user_id = tm.user_id and m.workspace_id = tm.workspace_id
        where tm.workspace_id = $1
        order by (tm.role = 'owner') desc, (tm.role = 'editor') desc, lower(u.email)`,
      [workspaceId],
    )
  ).rows
  const projects = (await db.query(`select id, name, team_id from core.projects where workspace_id = $1 and kind = 'research' order by created_at desc, name`, [workspaceId])).rows
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    isDefault: t.is_default,
    slackChannel: t.slack_channel,
    members: members.filter((m) => m.team_id === t.id).map((m) => ({ memberId: m.member_id, email: m.email, displayName: m.display_name, role: m.role as Role })),
    projects: projects.filter((p) => p.team_id === t.id).map((p) => ({ id: p.id, name: p.name })),
    gaps: 0,
  }))
}

async function teamOrThrow(tx: Queryable, workspaceId: string, id: string): Promise<{ id: string; name: string; is_default: boolean }> {
  const t = (await tx.query(`select id, name, is_default from core.teams where workspace_id = $1 and id = $2`, [workspaceId, id])).rows[0]
  if (!t) throw new TeamNotFound()
  return { id: t.id, name: t.name, is_default: t.is_default }
}

const nameTaken = async (tx: Queryable, workspaceId: string, name: string, exceptId?: string) =>
  !!(await tx.query(`select 1 from core.teams where workspace_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3::uuid)`, [workspaceId, name, exceptId ?? null])).rows[0]

/**
 * A team's people as the panel shows them: member id -> their role in the team, applied so the team ends with exactly these people. Each addition, role
 * change and removal is audited as the Teams screen always has. Inside the caller's transaction.
 */
async function applyMembers(tx: Queryable, ctx: RequestContext, team: { id: string; name: string }, want: Record<string, Role>): Promise<void> {
  const ids = Object.keys(want)
  const people = (await tx.query(`select m.id, m.user_id, u.email from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 and m.id = any($2::uuid[])`, [ctx.workspaceId, ids])).rows
  if (people.length !== ids.length) throw new PersonNotInWorkspace()
  const have = (await tx.query(`select tm.user_id, tm.role, u.email from core.team_memberships tm join core.users u on u.id = tm.user_id where tm.team_id = $1`, [team.id])).rows
  for (const person of people) {
    const role = want[person.id]
    const before = have.find((h) => h.user_id === person.user_id)
    if (before?.role === role) continue
    await tx.query(
      `insert into core.team_memberships (workspace_id, team_id, user_id, role, created_by, updated_by) values ($1, $2, $3, $4, $5, $5)
       on conflict (team_id, user_id) do update set role = excluded.role, updated_by = excluded.updated_by`,
      [ctx.workspaceId, team.id, person.user_id, role, ctx.userId],
    )
    await audit(tx, ctx, 'core.team_memberships', team.id, before ? 'role_changed' : 'added', before ? { team: team.name, email: person.email, role: before.role } : null, { team: team.name, email: person.email, role })
  }
  const keep = new Set(people.map((p) => p.user_id as string))
  for (const h of have) {
    if (keep.has(h.user_id)) continue
    await tx.query(`delete from core.team_memberships where team_id = $1 and user_id = $2`, [team.id, h.user_id])
    await audit(tx, ctx, 'core.team_memberships', team.id, 'removed', { team: team.name, email: h.email, role: h.role }, null)
  }
}

/** Makes a team, with its Slack channel (already cleaned) and its people, all or nothing. Teams made here are not the default. */
export async function createTeam(db: Db, ctx: RequestContext, input: { name: string; slackChannel?: string | null; members?: Record<string, Role> }, opts: { membersLocked?: boolean } = {}): Promise<string> {
  return db.transaction(async (tx) => {
    if (await nameTaken(tx, ctx.workspaceId, input.name)) throw new TeamNameTaken()
    // With sign-in groups deciding teams, people join a new team through their groups, not by being added here.
    if (opts.membersLocked && input.members && Object.keys(input.members).length > 0) throw new MembersManagedBySso()
    const id = (await tx.query(`insert into core.teams (workspace_id, name, slack_channel, created_by, updated_by) values ($1, $2, $3, $4, $4) returning id`, [ctx.workspaceId, input.name, input.slackChannel ?? null, ctx.userId])).rows[0].id as string
    await audit(tx, ctx, 'core.teams', id, 'created', null, { name: input.name, ...(input.slackChannel ? { slackChannel: input.slackChannel } : {}), ...(input.members ? { people: Object.keys(input.members).length } : {}) })
    if (input.members) await applyMembers(tx, ctx, { id, name: input.name }, input.members)
    return id
  })
}

/**
 * Saves a team as its panel shows it, all or nothing: its name, its Slack channel (already cleaned), its people (member id -> role there: the team ends with
 * exactly these) and projects moved to other teams (project id -> team id). Anything left out is unchanged. With `membersLocked` the people of a team other than
 * the default come from sign-in groups and are not changed here.
 */
export async function saveTeam(
  db: Db,
  ctx: RequestContext,
  id: string,
  input: { name?: string; slackChannel?: string | null; members?: Record<string, Role>; moveProjects?: Record<string, string> },
  opts: { membersLocked?: boolean } = {},
): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await teamOrThrow(tx, ctx.workspaceId, id)
    let name = t.name
    if (input.name !== undefined && input.name !== t.name) {
      if (await nameTaken(tx, ctx.workspaceId, input.name, id)) throw new TeamNameTaken()
      await tx.query(`update core.teams set name = $2, updated_by = $3 where id = $1`, [id, input.name, ctx.userId])
      await audit(tx, ctx, 'core.teams', id, 'renamed', { name: t.name }, { name: input.name })
      name = input.name
    }
    if (input.slackChannel !== undefined) {
      const before = (await tx.query(`select slack_channel from core.teams where id = $1 for update`, [id])).rows[0]
      if ((before.slack_channel ?? null) !== input.slackChannel) {
        await tx.query(`update core.teams set slack_channel = $2 where id = $1`, [id, input.slackChannel])
        await audit(tx, ctx, 'core.teams', id, 'slack_channel', { slackChannel: before.slack_channel ?? null }, { slackChannel: input.slackChannel })
      }
    }
    if (input.members !== undefined) {
      if (opts.membersLocked && !t.is_default) {
        const current = (await tx.query(`select m.id, tm.role from core.team_memberships tm join core.memberships m on m.user_id = tm.user_id and m.workspace_id = tm.workspace_id where tm.team_id = $1`, [id])).rows
        const same = current.length === Object.keys(input.members).length && current.every((c) => input.members![c.id] === c.role)
        if (!same) throw new MembersManagedBySso()
      }
      await applyMembers(tx, ctx, { id, name }, input.members)
    }
    for (const [projectId, to] of Object.entries(input.moveProjects ?? {})) {
      if (to === id) continue
      const target = await teamOrThrow(tx, ctx.workspaceId, to)
      const p = (await tx.query(`select name, team_id from core.projects where workspace_id = $1 and id = $2 and kind = 'research'`, [ctx.workspaceId, projectId])).rows[0]
      // Only a project of this team can be moved out of it from here.
      if (!p || p.team_id !== id) throw new ProjectNotFound()
      await tx.query(`update core.projects set team_id = $2, updated_by = $3 where id = $1`, [projectId, to, ctx.userId])
      await audit(tx, ctx, 'core.teams', projectId, 'project_moved', { project: p.name, team: name }, { project: p.name, team: target.name })
    }
  })
}

/** The channel a team's launches are announced in (a name without "#", already cleaned), or null for none. */
export async function setTeamSlackChannel(db: Db, ctx: RequestContext, id: string, channel: string | null): Promise<void> {
  await db.transaction(async (tx) => {
    const before = (await tx.query(`select slack_channel from core.teams where workspace_id = $1 and id = $2 for update`, [ctx.workspaceId, id])).rows[0]
    if (!before) throw new TeamNotFound()
    if ((before.slack_channel ?? null) === channel) return
    await tx.query(`update core.teams set slack_channel = $2 where id = $1`, [id, channel])
    await audit(tx, ctx, 'core.teams', id, 'slack_channel', { slackChannel: before.slack_channel ?? null }, { slackChannel: channel })
  })
}

/** The default team cannot go, and a team with projects must have them moved first. */
export async function deleteTeam(db: Db, ctx: RequestContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await teamOrThrow(tx, ctx.workspaceId, id)
    if (t.is_default) throw new TeamIsDefault()
    if ((await tx.query(`select 1 from core.projects where team_id = $1 limit 1`, [id])).rows[0]) throw new TeamNotEmpty()
    await tx.query(`delete from core.teams where id = $1`, [id])
    await audit(tx, ctx, 'core.teams', id, 'deleted', { name: t.name }, null)
  })
}

/** Puts a workspace member in a team with a role, or changes their role there. */
export async function setTeamMember(db: Db, ctx: RequestContext, teamId: string, memberId: string, role: Role): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await teamOrThrow(tx, ctx.workspaceId, teamId)
    const person = (await tx.query(`select m.user_id, u.email from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 and m.id = $2`, [ctx.workspaceId, memberId])).rows[0]
    if (!person) throw new PersonNotInWorkspace()
    const before = (await tx.query(`select role from core.team_memberships where team_id = $1 and user_id = $2`, [teamId, person.user_id])).rows[0]
    await tx.query(
      `insert into core.team_memberships (workspace_id, team_id, user_id, role, created_by, updated_by) values ($1, $2, $3, $4, $5, $5)
       on conflict (team_id, user_id) do update set role = excluded.role, updated_by = excluded.updated_by`,
      [ctx.workspaceId, teamId, person.user_id, role, ctx.userId],
    )
    if (before?.role !== role) await audit(tx, ctx, 'core.team_memberships', teamId, before ? 'role_changed' : 'added', before ? { team: t.name, email: person.email, role: before.role } : null, { team: t.name, email: person.email, role })
  })
}

export async function removeTeamMember(db: Db, ctx: RequestContext, teamId: string, memberId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const t = await teamOrThrow(tx, ctx.workspaceId, teamId)
    const person = (await tx.query(`select m.user_id, u.email from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 and m.id = $2`, [ctx.workspaceId, memberId])).rows[0]
    if (!person) throw new PersonNotInWorkspace()
    const gone = (await tx.query(`delete from core.team_memberships where team_id = $1 and user_id = $2 returning role`, [teamId, person.user_id])).rows[0]
    if (gone) await audit(tx, ctx, 'core.team_memberships', teamId, 'removed', { team: t.name, email: person.email, role: gone.role }, null)
  })
}

/** Moves a research project into a team. The project's version moves with the change, as for any edit. */
export async function moveProject(db: Db, ctx: RequestContext, teamId: string, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const to = await teamOrThrow(tx, ctx.workspaceId, teamId)
    const p = (await tx.query(`select p.name, p.team_id, t.name as team_name from core.projects p left join core.teams t on t.id = p.team_id where p.workspace_id = $1 and p.id = $2 and p.kind = 'research'`, [ctx.workspaceId, projectId])).rows[0]
    if (!p) throw new ProjectNotFound()
    if (p.team_id === teamId) return
    await tx.query(`update core.projects set team_id = $2, updated_by = $3 where id = $1`, [projectId, teamId, ctx.userId])
    await audit(tx, ctx, 'core.teams', projectId, 'project_moved', { project: p.name, team: p.team_name }, { project: p.name, team: to.name })
  })
}
