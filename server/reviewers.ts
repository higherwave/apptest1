// Launch reviewers, set up once (Admin, Members, Reviewers): a person, a step, the teams they cover (all, or named), primary or alternate; and
// which steps each team's launches use. Only owners change anything. The rules for who covers a step are in shared/launch.mjs.
import { coverageState, isOptionalStep, isStep, LAUNCH_STEPS, type Assignment, type CoverageState, type ReviewerRole } from '../shared/launch.mjs'
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { MemberNotFound } from './members.js'
import { TeamNotFound } from './team-admin.js'

export class ExternalAllTeams extends Error {}
export class PrimaryTaken extends Error {
  constructor(public who: string) {
    super(`${who} is already the primary for that step.`)
  }
}
export class BadStep extends Error {}
export class ReviewerNotFound extends Error {}

export type Person = { userId: string; name: string; email: string }
export type ReviewerRow = { id: string; userId: string; email: string; displayName: string; external: boolean; step: string; teamId: string | null; teamName: string | null; role: ReviewerRole }
export type CoverageCell = { step: string; state: CoverageState; scope: 'team' | 'all' | null; primary: Person[]; alternate: Person[] }
export type ReviewerTeam = { id: string; name: string; isDefault: boolean; stepsOff: string[]; steps: CoverageCell[] }
export type ReviewerOverview = { steps: { key: string; label: string; optional: boolean }[]; assignments: ReviewerRow[]; teams: ReviewerTeam[] }

const audit = (tx: Queryable, ctx: RequestContext, entity: 'core.reviewer_assignments' | 'core.team_launch_steps', id: string | null, verb: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.workspaceId, ctx.userId, entity, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

/** Every standing assignment, and for each team a coverage cell per step: covered, gap (a step the team uses with no primary), or not used. */
export async function reviewerOverview(db: Queryable, workspaceId: string): Promise<ReviewerOverview> {
  const rows = (
    await db.query(
      `select ra.id, ra.user_id, u.email, u.display_name, coalesce(m.is_external, false) as external, ra.step, ra.team_id, t.name as team_name, ra.role
         from core.reviewer_assignments ra
         join core.users u on u.id = ra.user_id
         left join core.memberships m on m.user_id = ra.user_id and m.workspace_id = ra.workspace_id
         left join core.teams t on t.id = ra.team_id
        where ra.workspace_id = $1
        order by array_position($2::text[], ra.step), (ra.team_id is not null), lower(t.name), (ra.role = 'alternate'), lower(u.email)`,
      [workspaceId, LAUNCH_STEPS.map((s) => s.key)],
    )
  ).rows
  const assignments: ReviewerRow[] = rows.map((r) => ({
    id: r.id, userId: r.user_id, email: r.email, displayName: r.display_name, external: !!r.external, step: r.step, teamId: r.team_id ?? null, teamName: r.team_name ?? null, role: r.role,
  }))
  const teams = (await db.query(`select id, name, is_default from core.teams where workspace_id = $1 order by is_default desc, lower(name)`, [workspaceId])).rows
  const off = (await db.query(`select s.team_id, s.step from core.team_launch_steps s join core.teams t on t.id = s.team_id where t.workspace_id = $1 and not s.used`, [workspaceId])).rows
  const people = new Map<string, Person>(assignments.map((a) => [a.userId, { userId: a.userId, name: a.displayName, email: a.email }]))
  const plain: Assignment[] = assignments.map((a) => ({ userId: a.userId, step: a.step, teamId: a.teamId, role: a.role }))
  return {
    steps: LAUNCH_STEPS.map((s) => ({ key: s.key, label: s.label, optional: s.optional })),
    assignments,
    teams: teams.map((t) => {
      const stepsOff = off.filter((o) => o.team_id === t.id).map((o) => o.step as string)
      return {
        id: t.id,
        name: t.name,
        isDefault: t.is_default,
        stepsOff,
        steps: LAUNCH_STEPS.map((s) => {
          const c = coverageState(plain, stepsOff, t.id, s.key)
          return { step: s.key, state: c.state, scope: c.scope, primary: c.primary.map((id) => people.get(id)!), alternate: c.alternate.map((id) => people.get(id)!) }
        }),
      }
    }),
  }
}

/**
 * Sets a person up for one or more steps, for all teams or for named teams. A step and scope the person already has is updated to the new role.
 * One primary per step and scope: a second one is refused with the name of the first.
 */
export async function addReviewer(db: Db, ctx: RequestContext, input: { memberId: string; steps: string[]; teams: 'all' | string[]; role: ReviewerRole }): Promise<void> {
  if (!input.steps.length || input.steps.some((s) => !isStep(s))) throw new BadStep()
  await db.transaction(async (tx) => {
    const member = (
      await tx.query(
        `select m.id, m.user_id, m.is_external, u.email, u.display_name from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 and m.id = $2`,
        [ctx.workspaceId, input.memberId],
      )
    ).rows[0]
    if (!member) throw new MemberNotFound()
    if (input.teams === 'all' && member.is_external) throw new ExternalAllTeams()
    let scopes: { id: string | null; name: string }[] = [{ id: null, name: 'all teams' }]
    if (input.teams !== 'all') {
      if (!input.teams.length) throw new TeamNotFound()
      const found = (await tx.query(`select id, name from core.teams where workspace_id = $1 and id = any($2::uuid[])`, [ctx.workspaceId, input.teams])).rows
      if (found.length !== new Set(input.teams).size) throw new TeamNotFound()
      scopes = found.map((t) => ({ id: t.id as string, name: t.name as string }))
    }
    for (const step of input.steps) {
      for (const scope of scopes) {
        const same = (
          await tx.query(
            `select id, user_id, role from core.reviewer_assignments where workspace_id = $1 and step = $2 and team_id is not distinct from $3::uuid`,
            [ctx.workspaceId, step, scope.id],
          )
        ).rows
        const mine = same.find((r) => r.user_id === member.user_id)
        const otherPrimary = same.find((r) => r.role === 'primary' && r.user_id !== member.user_id)
        if (input.role === 'primary' && otherPrimary) {
          const who = (await tx.query(`select display_name from core.users where id = $1`, [otherPrimary.user_id])).rows[0]?.display_name ?? 'Someone else'
          throw new PrimaryTaken(who)
        }
        const after = { email: member.email, step, teams: scope.name, role: input.role }
        if (mine) {
          if (mine.role !== input.role) {
            await tx.query(`update core.reviewer_assignments set role = $2 where id = $1`, [mine.id, input.role])
            await audit(tx, ctx, 'core.reviewer_assignments', mine.id, 'role changed', { ...after, role: mine.role }, after)
          }
        } else {
          const made = (
            await tx.query(
              `insert into core.reviewer_assignments (workspace_id, user_id, step, team_id, role, created_by) values ($1, $2, $3, $4, $5, $6) returning id`,
              [ctx.workspaceId, member.user_id, step, scope.id, input.role, ctx.userId],
            )
          ).rows[0]
          await audit(tx, ctx, 'core.reviewer_assignments', made.id, 'added', null, after)
        }
      }
    }
  })
}

export async function removeReviewer(db: Db, ctx: RequestContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const row = (
      await tx.query(
        `select ra.id, ra.step, ra.role, u.email, t.name as team_name
           from core.reviewer_assignments ra join core.users u on u.id = ra.user_id left join core.teams t on t.id = ra.team_id
          where ra.workspace_id = $1 and ra.id = $2`,
        [ctx.workspaceId, id],
      )
    ).rows[0]
    if (!row) throw new ReviewerNotFound()
    await tx.query(`delete from core.reviewer_assignments where id = $1`, [id])
    await audit(tx, ctx, 'core.reviewer_assignments', id, 'removed', { email: row.email, step: row.step, teams: row.team_name ?? 'all teams', role: row.role }, null)
  })
}

/** Which optional steps a team's launches use. `used` maps a step to true or false; the final decision always applies and is refused here. */
export async function setTeamSteps(db: Db, ctx: RequestContext, teamId: string, used: Record<string, boolean>): Promise<void> {
  const keys = Object.keys(used)
  if (keys.some((k) => !isOptionalStep(k))) throw new BadStep()
  await db.transaction(async (tx) => {
    const team = (await tx.query(`select id, name from core.teams where workspace_id = $1 and id = $2`, [ctx.workspaceId, teamId])).rows[0]
    if (!team) throw new TeamNotFound()
    const offOf = async () => (await tx.query(`select step from core.team_launch_steps where team_id = $1 and not used order by step`, [teamId])).rows.map((r) => r.step as string)
    const before = await offOf()
    for (const step of keys) {
      await tx.query(
        `insert into core.team_launch_steps (team_id, step, used) values ($1, $2, $3) on conflict (team_id, step) do update set used = excluded.used`,
        [teamId, step, used[step]],
      )
    }
    const after = await offOf()
    if (JSON.stringify(before) !== JSON.stringify(after)) await audit(tx, ctx, 'core.team_launch_steps', teamId, 'launch steps changed', { team: team.name, notUsed: before }, { team: team.name, notUsed: after })
  })
}
