// Workspace setup: the guided onboarding for workspace owners. Five categories in a fixed order, each unlocked when the one before is done (or skipped, if it is optional).
// A category's checks are read from the workspace itself (are there people, does every launch step have an approver, are there experience categories), so "done" means the
// thing exists, not that someone clicked through. Only the owner's "done" or "skipped" is recorded, in core.workspace_setup.
import { T } from '../shared/terms.mjs'
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { approvalsOverview } from './reviewers.js'
import { insertMany } from './sql.js'

export const SETUP_STEPS = [
  { key: 'people', optional: false },
  { key: 'approvals', optional: false },
  { key: 'categories', optional: false },
  { key: 'connections', optional: true },
  { key: 'guard', optional: false },
] as const
export type SetupKey = (typeof SETUP_STEPS)[number]['key']
/** `required: false` is shown but never holds the category back: it is good to have, not needed to carry on. */
export type SetupCheck = { label: string; ok: boolean; required: boolean }
export type SetupCategory = { key: SetupKey; optional: boolean; status: 'locked' | 'current' | 'done' | 'skipped'; checks: SetupCheck[] }
export type Setup = { categories: SetupCategory[]; done: number; total: number; complete: boolean }

export class BadSetupStep extends Error {}
export class SetupLocked extends Error {}
export class SetupNotReady extends Error {}
export class NotOptional extends Error {}

const count = async (db: Queryable, sql: string, params: unknown[]) => (await db.query(sql, params)).rows[0].n as number

async function checksFor(db: Queryable, workspaceId: string, key: SetupKey, jiraConnected: boolean): Promise<SetupCheck[]> {
  switch (key) {
    case 'people': {
      const people = await count(db, `select count(*)::int n from core.memberships where workspace_id = $1`, [workspaceId])
      const noEditor = await count(
        db,
        `select count(*)::int n from core.teams t where t.workspace_id = $1 and not exists (select 1 from core.team_memberships tm where tm.team_id = t.id and tm.role <> 'viewer')`,
        [workspaceId],
      )
      return [
        { label: 'Someone besides you has been invited or has joined', ok: people > 1, required: true },
        { label: 'Every team has at least one person who can edit', ok: noEditor === 0, required: true },
      ]
    }
    case 'approvals': {
      const o = await approvalsOverview(db, workspaceId)
      return [{ label: `Every launch step in use has ${T.a('approver')}`, ok: o.gaps === 0, required: true }]
    }
    case 'categories': {
      const total = await count(db, `select count(*)::int n from insights.feature_areas where workspace_id = $1 and retired_at is null`, [workspaceId])
      const bare = await count(db, `select count(*)::int n from insights.feature_areas where workspace_id = $1 and retired_at is null and coalesce(btrim(definition), '') = ''`, [workspaceId])
      return [
        { label: 'At least one experience category', ok: total >= 1, required: true },
        { label: 'Each has a one-line definition, so people file things the same way', ok: total > 0 && bare === 0, required: false },
      ]
    }
    case 'connections': {
      const noChannel = await count(db, `select count(*)::int n from core.teams where workspace_id = $1 and coalesce(btrim(slack_channel), '') = ''`, [workspaceId])
      return [
        { label: 'Each team has a Slack channel for launch threads', ok: noChannel === 0, required: false },
        { label: 'Jira is connected', ok: jiraConnected, required: false },
      ]
    }
    case 'guard':
      return []
  }
}

/** The setup as it stands: each category's status in order, and the live checks. `jiraConnected` comes from the workspace's integrations. */
export async function getSetup(db: Queryable, workspaceId: string, jiraConnected: boolean): Promise<Setup> {
  const recorded = new Map((await db.query(`select step, status from core.workspace_setup where workspace_id = $1`, [workspaceId])).rows.map((r) => [r.step as string, r.status as 'done' | 'skipped']))
  let open = false
  const categories: SetupCategory[] = []
  for (const s of SETUP_STEPS) {
    const rec = recorded.get(s.key)
    const status: SetupCategory['status'] = rec ?? (open ? 'locked' : 'current')
    if (!rec) open = true
    categories.push({ key: s.key, optional: s.optional, status, checks: await checksFor(db, workspaceId, s.key, jiraConnected) })
  }
  const done = categories.filter((c) => c.status === 'done' || c.status === 'skipped').length
  return { categories, done, total: categories.length, complete: done === categories.length }
}

/** An owner marks the current category done (every check passing, unless it is optional) or skips it (optional ones only). Earlier categories must be finished. */
export async function markSetup(db: Db, ctx: RequestContext, step: string, status: 'done' | 'skipped', jiraConnected: boolean): Promise<Setup> {
  const def = SETUP_STEPS.find((s) => s.key === step)
  if (!def) throw new BadSetupStep()
  if (status === 'skipped' && !def.optional) throw new NotOptional()
  const now = await getSetup(db, ctx.workspaceId, jiraConnected)
  const cat = now.categories.find((c) => c.key === step)!
  if (cat.status === 'locked') throw new SetupLocked()
  if (status === 'done' && !cat.checks.every((c) => c.ok || !c.required)) throw new SetupNotReady()
  await db.transaction(async (tx) => {
    await tx.query(
      `insert into core.workspace_setup (workspace_id, step, status, updated_by) values ($1, $2, $3, $4)
       on conflict (workspace_id, step) do update set status = excluded.status, updated_by = excluded.updated_by, updated_at = now()`,
      [ctx.workspaceId, step, status, ctx.userId],
    )
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.workspace_setup', entity_id: null, verb: status === 'done' ? 'completed' : 'skipped', after: { step } }])
  })
  return getSetup(db, ctx.workspaceId, jiraConnected)
}
