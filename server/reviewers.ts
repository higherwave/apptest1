// Launch approvers, set up once per step (Admin, Approvals): the workspace's approver and backup, and for a team that needs someone else its own approver
// (and backup), or the step not used. Only owners change anything. The rules for who covers a step are in shared/launch.mjs.
import { coverageState, isOptionalStep, isStep, LAUNCH_STEPS, type Assignment, type CoverageState, type ReviewerRole } from '../shared/launch.mjs'
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { MemberNotFound } from './members.js'
import { TeamNotFound } from './team-admin.js'

export class ExternalAllTeams extends Error {}
export class BadStep extends Error {}
export class NoAlternate extends Error {}
export class BackupNeedsApprover extends Error {}
export class SamePerson extends Error {}

export type Person = { userId: string; name: string; email: string }

const audit = (tx: Queryable, ctx: RequestContext, entity: 'core.reviewer_assignments' | 'core.team_launch_steps', id: string | null, verb: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.workspaceId, ctx.userId, entity, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

export type ApprovalPerson = Person & { external: boolean; unavailable: boolean }
export type ApprovalTeamCell = {
  teamId: string
  /** `default` uses the workspace approver; `custom` has its own approver (and backup); `off` means the team does not use the step. */
  mode: 'default' | 'custom' | 'off'
  approver: ApprovalPerson | null
  backup: ApprovalPerson | null
  /** What the team ends up with: `covered` (someone approves), `gap` (a step it uses, with nobody), or `not_used`. */
  state: CoverageState
  /** Who approves for this team, whether by the workspace or by the team's own choice. */
  effective: ApprovalPerson | null
}
export type ApprovalStep = { key: string; label: string; optional: boolean; approver: ApprovalPerson | null; backup: ApprovalPerson | null; teams: ApprovalTeamCell[] }
export type ApprovalsOverview = {
  steps: ApprovalStep[]
  teams: { id: string; name: string; isDefault: boolean }[]
  /** Everyone in the workspace, for the pickers. */
  people: ApprovalPerson[]
  /** The cells of the grid that are a gap: a team uses the step and nobody approves it. */
  gaps: number
}

/** Who approves each step: the workspace's approver and backup, and for each team what it uses (the workspace's, its own, or not the step at all). */
export async function approvalsOverview(db: Queryable, workspaceId: string): Promise<ApprovalsOverview> {
  const rows = (await db.query(`select user_id, step, team_id, role from core.reviewer_assignments where workspace_id = $1 order by created_at, id`, [workspaceId])).rows
  const peopleRows = (
    await db.query(
      `select u.id, u.email, u.display_name, coalesce(m.is_external, false) as external, coalesce(m.reviewing_unavailable, false) as unavailable
         from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 order by lower(u.display_name), lower(u.email)`,
      [workspaceId],
    )
  ).rows
  const people: ApprovalPerson[] = peopleRows.map((r) => ({ userId: r.id, name: r.display_name, email: r.email, external: !!r.external, unavailable: !!r.unavailable }))
  const byId = new Map(people.map((p) => [p.userId, p]))
  const teams = (await db.query(`select id, name, is_default from core.teams where workspace_id = $1 order by is_default desc, lower(name)`, [workspaceId])).rows
  const offRows = (await db.query(`select s.team_id, s.step from core.team_launch_steps s join core.teams t on t.id = s.team_id where t.workspace_id = $1 and not s.used`, [workspaceId])).rows
  const plain: Assignment[] = rows.map((r) => ({ userId: r.user_id, step: r.step, teamId: r.team_id ?? null, role: r.role, unavailable: byId.get(r.user_id)?.unavailable ?? false }))
  const pick = (step: string, teamId: string | null, role: ReviewerRole) => {
    const r = rows.find((x) => x.step === step && (x.team_id ?? null) === teamId && x.role === role)
    return r ? byId.get(r.user_id) ?? null : null
  }
  let gaps = 0
  const steps: ApprovalStep[] = LAUNCH_STEPS.map((s) => ({
    key: s.key,
    label: s.label,
    optional: s.optional,
    approver: pick(s.key, null, 'primary'),
    backup: pick(s.key, null, 'alternate'),
    teams: teams.map((t) => {
      const off = offRows.filter((o) => o.team_id === t.id).map((o) => o.step as string)
      const c = coverageState(plain, off, t.id, s.key)
      const custom = c.scope === 'team'
      const mode = c.state === 'not_used' ? 'off' : custom ? 'custom' : 'default'
      if (c.state === 'gap') gaps += 1
      return {
        teamId: t.id,
        mode,
        approver: mode === 'custom' ? pick(s.key, t.id, 'primary') : null,
        backup: mode === 'custom' ? pick(s.key, t.id, 'alternate') : null,
        state: c.state,
        effective: c.primary[0] ? byId.get(c.primary[0]) ?? null : null,
      }
    }),
  }))
  return { steps, teams: teams.map((t) => ({ id: t.id, name: t.name, isDefault: t.is_default })), people, gaps }
}

export type ApprovalStepInput = {
  approver: string | null
  backup: string | null
  /** Each team: the workspace's approvers, its own, or the step not used. A team left out uses the workspace's. */
  teams: Record<string, { mode: 'default' | 'custom' | 'off'; approver?: string | null; backup?: string | null }>
}

const summary = (o: ApprovalsOverview, step: string) => {
  const s = o.steps.find((x) => x.key === step)!
  const name = (p: ApprovalPerson | null) => p?.email ?? null
  return {
    approver: name(s.approver),
    backup: name(s.backup),
    teams: Object.fromEntries(s.teams.map((t) => [o.teams.find((x) => x.id === t.teamId)?.name ?? t.teamId, t.mode === 'off' ? 'not used' : t.mode === 'custom' ? { approver: name(t.approver), backup: name(t.backup) } : 'workspace'])),
  }
}

/**
 * Saves one step as the Approvals panel shows it, all or nothing: the workspace approver and backup, and for each team the workspace's, its own or not
 * used. A backup needs an approver and cannot be the same person. An external person can approve for a team only, never for the workspace. The final
 * decision is always used. One audit entry says what changed.
 */
export async function saveApprovalStep(db: Db, ctx: RequestContext, step: string, input: ApprovalStepInput): Promise<void> {
  if (!isStep(step)) throw new BadStep()
  await db.transaction(async (tx) => {
    const ids = new Set<string>()
    const want = (id: string | null | undefined) => { if (id) ids.add(id) }
    want(input.approver); want(input.backup)
    for (const t of Object.values(input.teams)) { want(t.approver); want(t.backup) }
    const known = new Map(
      (await tx.query(`select m.user_id, m.is_external from core.memberships m where m.workspace_id = $1 and m.user_id = any($2::uuid[])`, [ctx.workspaceId, [...ids]])).rows.map((r) => [r.user_id as string, !!r.is_external]),
    )
    if ([...ids].some((id) => !known.has(id))) throw new MemberNotFound()
    const teamIds = Object.keys(input.teams)
    const found = (await tx.query(`select id from core.teams where workspace_id = $1 and id = any($2::uuid[])`, [ctx.workspaceId, teamIds])).rows
    if (found.length !== teamIds.length) throw new TeamNotFound()

    if (input.backup && !input.approver) throw new BackupNeedsApprover()
    if (input.approver && input.approver === input.backup) throw new SamePerson()
    if ((input.approver && known.get(input.approver)) || (input.backup && known.get(input.backup))) throw new ExternalAllTeams()
    for (const t of Object.values(input.teams)) {
      if (t.mode === 'off' && !isOptionalStep(step)) throw new BadStep()
      if (t.mode !== 'custom') continue
      if (!t.approver) throw new BackupNeedsApprover()
      if (t.approver === t.backup) throw new SamePerson()
    }

    const before = summary(await approvalsOverview(tx, ctx.workspaceId), step)
    await tx.query(`delete from core.reviewer_assignments where workspace_id = $1 and step = $2`, [ctx.workspaceId, step])
    const add = async (userId: string | null | undefined, teamId: string | null, role: ReviewerRole) => {
      if (!userId) return
      await tx.query(`insert into core.reviewer_assignments (workspace_id, user_id, step, team_id, role, created_by) values ($1, $2, $3, $4, $5, $6)`, [ctx.workspaceId, userId, step, teamId, role, ctx.userId])
    }
    await add(input.approver, null, 'primary')
    await add(input.backup, null, 'alternate')
    for (const [teamId, t] of Object.entries(input.teams)) {
      if (t.mode === 'custom') {
        await add(t.approver, teamId, 'primary')
        await add(t.backup, teamId, 'alternate')
      }
    }
    // Which teams use the step: the final decision is always used, so nothing is stored for it.
    if (isOptionalStep(step)) {
      const allTeams = (await tx.query(`select id from core.teams where workspace_id = $1`, [ctx.workspaceId])).rows.map((r) => r.id as string)
      for (const teamId of allTeams) {
        const used = input.teams[teamId]?.mode !== 'off'
        await tx.query(`insert into core.team_launch_steps (team_id, step, used) values ($1, $2, $3) on conflict (team_id, step) do update set used = excluded.used`, [teamId, step, used])
      }
    }
    const after = summary(await approvalsOverview(tx, ctx.workspaceId), step)
    if (JSON.stringify(before) !== JSON.stringify(after)) await audit(tx, ctx, 'core.reviewer_assignments', null, 'approvers changed', { step, ...before }, { step, ...after })
  })
}

/**
 * Marks an approver away (or back). Away needs a backup for every step they are primary for: the backup of the same team (or of all teams) who is
 * not away themselves. Returns who now covers what, so they can be told; empty when nothing changed or the person is back.
 */
export async function setReviewerUnavailable(db: Db, ctx: RequestContext, userId: string, unavailable: boolean): Promise<{ away: string; covering: { person: Person; steps: string[] }[] }> {
  return db.transaction(async (tx) => {
    const m = (await tx.query(`select m.id, m.reviewing_unavailable, u.display_name from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 and m.user_id = $2 for update`, [ctx.workspaceId, userId])).rows[0]
    if (!m) throw new MemberNotFound()
    if (!!m.reviewing_unavailable === unavailable) return { away: m.display_name as string, covering: [] }
    const covering = new Map<string, { person: Person; steps: string[] }>() // keyed by the alternate's user id
    type Row = { user_id: string; email: string; display_name: string }
    if (unavailable) {
      const mine = (await tx.query(`select step, team_id from core.reviewer_assignments where workspace_id = $1 and user_id = $2 and role = 'primary'`, [ctx.workspaceId, userId])).rows
      if (mine.length === 0) throw new NoAlternate()
      for (const a of mine) {
        const alts = (
          await tx.query(
            `select ra.user_id, u.email, u.display_name from core.reviewer_assignments ra join core.users u on u.id = ra.user_id
               left join core.memberships am on am.user_id = ra.user_id and am.workspace_id = ra.workspace_id
              where ra.workspace_id = $1 and ra.role = 'alternate' and ra.step = $2 and ra.user_id <> $3 and not coalesce(am.reviewing_unavailable, false)
                and ra.team_id is not distinct from $4`,
            [ctx.workspaceId, a.step, userId, a.team_id],
          )
        ).rows
        if (alts.length === 0) throw new NoAlternate()
        const label = LAUNCH_STEPS.find((x) => x.key === a.step)?.label ?? a.step
        for (const alt of alts as Row[]) {
          const entry = covering.get(alt.user_id) ?? { person: { userId: alt.user_id, name: alt.display_name, email: alt.email }, steps: [] }
          if (!entry.steps.includes(label)) entry.steps.push(label)
          covering.set(alt.user_id, entry)
        }
      }
    }
    await tx.query(`update core.memberships set reviewing_unavailable = $2, updated_by = $3 where id = $1`, [m.id, unavailable, ctx.userId])
    await audit(tx, ctx, 'core.reviewer_assignments', null, unavailable ? 'marked unavailable' : 'marked available', { person: m.display_name, unavailable: !unavailable }, { person: m.display_name, unavailable })
    return { away: m.display_name as string, covering: [...covering.values()] }
  })
}
