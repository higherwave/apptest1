// Who can use the workspace. A member is an invitation: a core.users row (the email) plus a core.memberships row (the
// role). The person's first Google sign-in links it to their account (see context.ts). Only owners change anything.
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { ApiError } from './errors.js'
import { LAUNCH_STEPS } from '../shared/launch.mjs'

export type Role = 'owner' | 'editor' | 'viewer'
export type MemberTeam = { teamId: string; name: string; role: Role }
export type MemberApproval = { step: string; label: string; role: 'approver' | 'backup'; teamId: string | null; teamName: string | null }
/** `teams` and `approvals` are what the People screen shows beside the person: the teams they are in with their role there, and the steps they approve. */
export type Member = { id: string; email: string; displayName: string; role: Role; status: 'active' | 'invited'; avatarUrl: string | null; external: boolean; teams: MemberTeam[]; approvals: MemberApproval[] }

export class MemberNotFound extends Error {}
export class AlreadyMember extends Error {}
export class LastOwner extends Error {}
/** An external member can only be a viewer, and cannot cover every team as a reviewer. */
export class ExternalNeedsViewer extends Error {}
/** An external person does not join teams: they see a launch only when they are asked to approve it. */
export class ExternalNoTeams extends Error {}
/** Places in teams other than the default come from sign-in groups, so they are not edited here. */
export class TeamsManagedBySso extends Error {}
export class UnknownTeam extends Error {}

const MEMBER_SELECT = `
  select m.id, m.user_id, u.email, u.display_name, m.role, u.avatar_url, (u.auth_subject is not null) as active, m.is_external
  from core.memberships m join core.users u on u.id = m.user_id`

const toMember = (r: Record<string, any>): Member => ({
  id: r.id, email: r.email, displayName: r.display_name, role: r.role, status: r.active ? 'active' : 'invited', avatarUrl: r.avatar_url ?? null, external: !!r.is_external, teams: [], approvals: [],
})

// The teams and approvals of these people, in two queries.
async function attach(db: Queryable, workspaceId: string, rows: Record<string, any>[]): Promise<Member[]> {
  if (rows.length === 0) return []
  const ids = rows.map((r) => r.user_id as string)
  const teams = (
    await db.query(
      `select tm.user_id, tm.team_id, t.name, tm.role from core.team_memberships tm join core.teams t on t.id = tm.team_id
        where tm.workspace_id = $1 and tm.user_id = any($2::uuid[]) order by t.is_default desc, lower(t.name)`,
      [workspaceId, ids],
    )
  ).rows
  const approvals = (
    await db.query(
      `select ra.user_id, ra.step, ra.role, ra.team_id, t.name as team_name from core.reviewer_assignments ra left join core.teams t on t.id = ra.team_id
        where ra.workspace_id = $1 and ra.user_id = any($2::uuid[])`,
      [workspaceId, ids],
    )
  ).rows
  const order = LAUNCH_STEPS.map((s) => s.key as string)
  return rows.map((r) => ({
    ...toMember(r),
    teams: teams.filter((t) => t.user_id === r.user_id).map((t) => ({ teamId: t.team_id, name: t.name, role: t.role as Role })),
    approvals: approvals
      .filter((a) => a.user_id === r.user_id)
      .sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step) || (a.team_id ? 1 : 0) - (b.team_id ? 1 : 0))
      .map((a) => ({ step: a.step, label: LAUNCH_STEPS.find((x) => x.key === a.step)?.label ?? a.step, role: a.role === 'primary' ? ('approver' as const) : ('backup' as const), teamId: a.team_id ?? null, teamName: a.team_name ?? null })),
  }))
}

export async function listMembers(db: Queryable, workspaceId: string): Promise<Member[]> {
  const { rows } = await db.query(`${MEMBER_SELECT} where m.workspace_id = $1 order by (m.role = 'owner') desc, (m.role = 'editor') desc, lower(u.email)`, [workspaceId])
  return attach(db, workspaceId, rows)
}

async function getMember(db: Queryable, workspaceId: string, id: string): Promise<Member | undefined> {
  const { rows } = await db.query(`${MEMBER_SELECT} where m.workspace_id = $1 and m.id = $2`, [workspaceId, id])
  return rows[0] ? (await attach(db, workspaceId, rows))[0] : undefined
}

// Locks the workspace's owner rows for the rest of the transaction, so two owners cannot demote each other at once.
async function ownerCount(tx: Queryable, workspaceId: string): Promise<number> {
  const { rows } = await tx.query(`select id from core.memberships where workspace_id = $1 and role = 'owner' for update`, [workspaceId])
  return rows.length
}

const audit = (tx: Queryable, ctx: RequestContext, verb: string, id: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'core.memberships', $3, $4, $5, $6)`, [
    ctx.workspaceId, ctx.userId, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

/**
 * Sets a person's places in teams to exactly `want` (team id -> role), in the caller's transaction: added, changed or taken out, each audited as the Teams
 * screen does. Teams not in `want` are left only if `keep` says so (a team their sign-in groups decide).
 */
async function applyTeams(tx: Queryable, ctx: RequestContext, userId: string, email: string, want: Record<string, Role>, keep: (team: { id: string; is_default: boolean }) => boolean): Promise<void> {
  const teams = (await tx.query(`select id, name, is_default from core.teams where workspace_id = $1`, [ctx.workspaceId])).rows as { id: string; name: string; is_default: boolean }[]
  if (Object.keys(want).some((id) => !teams.some((t) => t.id === id))) throw new UnknownTeam()
  const have = new Map((await tx.query(`select team_id, role from core.team_memberships where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, userId])).rows.map((r) => [r.team_id as string, r.role as Role]))
  const log = (teamId: string, verb: string, before: unknown, after: unknown) =>
    tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'core.team_memberships', $3, $4, $5, $6)`, [
      ctx.workspaceId, ctx.userId, teamId, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
    ])
  for (const t of teams) {
    const before = have.get(t.id)
    const after = want[t.id]
    if (after) {
      if (before === after) continue
      await tx.query(
        `insert into core.team_memberships (workspace_id, team_id, user_id, role, created_by, updated_by) values ($1, $2, $3, $4, $5, $5)
         on conflict (team_id, user_id) do update set role = excluded.role, updated_by = excluded.updated_by`,
        [ctx.workspaceId, t.id, userId, after, ctx.userId],
      )
      await log(t.id, before ? 'role_changed' : 'added', before ? { team: t.name, email, role: before } : null, { team: t.name, email, role: after })
    } else if (before && !keep(t)) {
      await tx.query(`delete from core.team_memberships where team_id = $1 and user_id = $2`, [t.id, userId])
      await log(t.id, 'removed', { team: t.name, email, role: before }, null)
    }
  }
}

export async function inviteMember(db: Db, ctx: RequestContext, input: { email: string; role: Role; external?: boolean; teams?: Record<string, Role> }): Promise<Member> {
  const email = input.email.trim().toLowerCase()
  if (input.external && input.role !== 'viewer') throw new ExternalNeedsViewer()
  if (input.external && input.teams && Object.keys(input.teams).length > 0) throw new ExternalNoTeams()
  return db.transaction(async (tx) => {
    const found = await tx.query(`select id from core.users where lower(email) = $1`, [email])
    let userId: string = found.rows[0]?.id
    if (!userId) {
      const made = await tx.query(`insert into core.users (email, display_name) values ($1, $2) returning id`, [email, email.split('@')[0]])
      userId = made.rows[0].id
    }
    const dup = await tx.query(`select id from core.memberships where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, userId])
    if (dup.rows[0]) throw new AlreadyMember()
    const made = await tx.query(
      `insert into core.memberships (workspace_id, user_id, role, is_external, created_by, updated_by) values ($1, $2, $3, $5, $4, $4) returning id`,
      [ctx.workspaceId, userId, input.role, ctx.userId, !!input.external],
    )
    // A new member starts in the default team (a trigger); the invitation's own choice of teams replaces that, and an external person joins none.
    const want = input.external ? {} : input.teams
    if (want) await applyTeams(tx, ctx, userId, email, want, () => false)
    await audit(tx, ctx, 'invited', made.rows[0].id, null, { email, role: input.role, ...(input.external ? { external: true } : {}) })
    return (await getMember(tx, ctx.workspaceId, made.rows[0].id))!
  })
}

/**
 * Changes a member in one step, all or nothing: their workspace role and/or their places in teams (team id -> role there). An external person is a viewer
 * and joins no team, and cannot be made anything else: the flag is set when they are invited. With `teamsLocked`, the teams other than the default one
 * come from sign-in groups and are not changed here.
 */
export async function updateMember(db: Db, ctx: RequestContext, id: string, input: { role?: Role; teams?: Record<string, Role> }, opts: { teamsLocked?: boolean } = {}): Promise<Member> {
  return db.transaction(async (tx) => {
    const before = await getMember(tx, ctx.workspaceId, id)
    if (!before) throw new MemberNotFound()
    if (input.role !== undefined && input.role !== before.role) {
      if (before.role === 'owner' && (await ownerCount(tx, ctx.workspaceId)) <= 1) throw new LastOwner()
      if (before.external) throw new ExternalNeedsViewer()
      await tx.query(`update core.memberships set role = $3, updated_by = $4 where workspace_id = $1 and id = $2`, [ctx.workspaceId, id, input.role, ctx.userId])
      await audit(tx, ctx, 'role changed', id, { email: before.email, role: before.role }, { email: before.email, role: input.role })
    }
    if (input.teams !== undefined) {
      if (before.external && Object.keys(input.teams).length > 0) throw new ExternalNoTeams()
      const user = (await tx.query(`select user_id from core.memberships where id = $1`, [id])).rows[0]
      if (opts.teamsLocked) {
        // Only the default team can be changed by hand: anything asked of another team has to be what it already is.
        const current = new Map(before.teams.map((t) => [t.teamId, t.role]))
        const teams = (await tx.query(`select id, is_default from core.teams where workspace_id = $1`, [ctx.workspaceId])).rows as { id: string; is_default: boolean }[]
        if (teams.some((t) => !t.is_default && current.get(t.id) !== input.teams![t.id])) throw new TeamsManagedBySso()
      }
      await applyTeams(tx, ctx, user.user_id, before.email, input.teams, (t) => !!opts.teamsLocked && !t.is_default)
    }
    return (await getMember(tx, ctx.workspaceId, id))!
  })
}

/**
 * Ends a person's approvals when they leave: where they were the workspace's approver for a step, its backup takes over (so the step is still covered);
 * where they were a backup, they are simply dropped; a team's own approver (and backup) for a step is dropped, so that team uses the workspace's. Returns
 * how many steps passed to a backup, so the audit entry can say.
 */
async function handOverApprovals(tx: Queryable, workspaceId: string, userId: string): Promise<{ promoted: number; ended: number }> {
  const mine = (await tx.query(`select id, step, team_id, role from core.reviewer_assignments where workspace_id = $1 and user_id = $2`, [workspaceId, userId])).rows
  let promoted = 0
  for (const a of mine) {
    if (a.role !== 'primary') continue
    if (a.team_id) {
      // The team goes back to the workspace's approver: its own backup goes too, because a team's backup alone counts for nothing.
      await tx.query(`delete from core.reviewer_assignments where workspace_id = $1 and step = $2 and team_id = $3 and id <> $4`, [workspaceId, a.step, a.team_id, a.id])
    } else {
      const backup = (await tx.query(`select id from core.reviewer_assignments where workspace_id = $1 and step = $2 and team_id is null and role = 'alternate' and user_id <> $3 limit 1`, [workspaceId, a.step, userId])).rows[0]
      if (backup) {
        await tx.query(`update core.reviewer_assignments set role = 'primary' where id = $1`, [backup.id])
        promoted += 1
      }
    }
  }
  await tx.query(`delete from core.reviewer_assignments where workspace_id = $1 and user_id = $2`, [workspaceId, userId])
  return { promoted, ended: mine.length }
}

export async function removeMember(db: Db, ctx: RequestContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await getMember(tx, ctx.workspaceId, id)
    if (!before) throw new MemberNotFound()
    if (before.role === 'owner' && (await ownerCount(tx, ctx.workspaceId)) <= 1) throw new LastOwner()
    const user = (await tx.query(`select u.id, u.auth_subject from core.memberships m join core.users u on u.id = m.user_id where m.id = $1`, [id])).rows[0]
    await tx.query(`delete from core.memberships where workspace_id = $1 and id = $2`, [ctx.workspaceId, id])
    // Out of the workspace means out of every team.
    if (user) await tx.query(`delete from core.team_memberships where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, user.id])
    // And out of every approval: a backup takes over from an approver who leaves, and a step nobody else covers shows as "approver missing".
    const handed = user ? await handOverApprovals(tx, ctx.workspaceId, user.id) : { promoted: 0, ended: 0 }
    // Their open sessions end now, not when the cookie expires.
    if (user?.auth_subject) await tx.query(`delete from public.auth_session where user_id = $1`, [user.auth_subject])
    await audit(tx, ctx, 'removed', id, { email: before.email, role: before.role, ...(handed.ended ? { approvals: handed.ended, passedToBackup: handed.promoted } : {}) }, null)
  })
}

// What the company sign-in does on its own: adds a signed-in person who has no invitation (SSO_DEFAULT_ROLE, or a group that
// grants a role), and keeps an existing member's role in step with their groups. Both are audited, with the person as the actor.
// A workspace never loses its only owner this way.
export async function ssoSetRole(db: Db, workspaceId: string, who: { id: string; email: string; name: string; image: string | null }, role: Role): Promise<void> {
  await db.transaction(async (tx) => {
    const email = who.email.trim().toLowerCase()
    let user = (await tx.query(`select id, auth_subject from core.users where lower(email) = $1`, [email])).rows[0]
    if (user?.auth_subject && user.auth_subject !== who.id) throw new ApiError(403, 'account_mismatch', `${who.email} is already linked to a different sign-in account.`)
    if (!user) user = (await tx.query(`insert into core.users (email, display_name, avatar_url) values ($1, $2, $3) returning id, auth_subject`, [email, who.name || email.split('@')[0], who.image])).rows[0]
    const before = (await tx.query(`select id, role from core.memberships where workspace_id = $1 and user_id = $2 for update`, [workspaceId, user.id])).rows[0]
    if (before?.role === role) return
    if (before?.role === 'owner' && (await ownerCount(tx, workspaceId)) <= 1) return
    const id: string = before
      ? (await tx.query(`update core.memberships set role = $3, updated_by = $2 where workspace_id = $1 and user_id = $2 returning id`, [workspaceId, user.id, role])).rows[0].id
      : (await tx.query(`insert into core.memberships (workspace_id, user_id, role, created_by, updated_by) values ($1, $2, $3, $2, $2) returning id`, [workspaceId, user.id, role])).rows[0].id
    await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'core.memberships', $3, $4, $5, $6)`, [
      workspaceId, user.id, id, before ? 'role set by sign-in groups' : 'added by sign-in', before ? JSON.stringify({ email, role: before.role }) : null, JSON.stringify({ email, role }),
    ])
  })
}
