// How long things are kept, and legal holds. The rules (decided 2026-11-16):
//   - what a person deletes is held in the Trash for 90 days (server/trash.ts), then removed for good;
//   - the audit log and the AI usage are kept for 12 months, then removed (always downloadable before that: server/export.ts);
//   - notification records and Slack post records keep no content after 12 months, only the marker that a message was sent, so a launch that
//     runs longer than a year never repeats a message;
//   - projects, transcripts, themes, requirements, stories and launch answers are kept for the life of the workspace.
// A legal hold stops all of that for what it covers until an owner releases it. A hold on the workspace covers everything; a hold on a project
// covers that project's Trash entries, and any hold at all pauses the 12-month cleanup of the audit log and usage for the workspace (they are the
// evidence of what happened to the held material).
import type { Db, Queryable } from './db.js'
import { ApiError } from './errors.js'

export const AGE_MONTHS = 12

export type LegalHold = {
  id: string
  scope: 'workspace' | 'project'
  projectId: string | null
  scopeName: string
  reason: string
  setBy: { id: string; name: string } | null
  setAt: string
  releasedBy: { id: string; name: string } | null
  releasedAt: string | null
}
export type LegalHoldList = { data: LegalHold[] }

const SELECT = `select h.id, h.project_id, h.scope_name, h.reason, h.set_by, su.display_name as set_name, h.set_at::text as set_at, h.released_by, ru.display_name as released_name, h.released_at::text as released_at
                  from core.legal_holds h left join core.users su on su.id = h.set_by left join core.users ru on ru.id = h.released_by`

const shape = (r: Record<string, any>): LegalHold => ({
  id: r.id,
  scope: r.project_id ? 'project' : 'workspace',
  projectId: r.project_id ?? null,
  scopeName: r.scope_name,
  reason: r.reason,
  setBy: r.set_by ? { id: r.set_by, name: String(r.set_name ?? '') } : null,
  setAt: new Date(r.set_at).toISOString(),
  releasedBy: r.released_by ? { id: r.released_by, name: String(r.released_name ?? '') } : null,
  releasedAt: r.released_at ? new Date(r.released_at).toISOString() : null,
})

/** Active holds first, then the released ones (the history), newest first. */
export async function listHolds(db: Queryable, workspaceId: string): Promise<LegalHoldList> {
  const { rows } = await db.query(`${SELECT} where h.workspace_id = $1 order by (h.released_at is null) desc, coalesce(h.released_at, h.set_at) desc, h.id`, [workspaceId])
  return { data: rows.map(shape) }
}

type Actor = { workspaceId: string; userId: string }
const audit = (tx: Queryable, who: Actor, verb: string, h: Record<string, any>, extra: Record<string, unknown> = {}) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'core.legal_holds', $3, $4, null, $5)`, [who.workspaceId, who.userId, h.id, verb, JSON.stringify({ scope: h.project_id ? 'project' : 'workspace', scopeName: h.scope_name, ...extra })])

export async function placeHold(db: Db, who: Actor, input: { projectId?: string | null; reason: string }): Promise<LegalHold> {
  return db.transaction(async (tx) => {
    let scopeName: string
    if (input.projectId) {
      const p = (await tx.query(`select name from core.projects where id = $1 and workspace_id = $2 and kind = 'research'`, [input.projectId, who.workspaceId])).rows[0]
      // A project that is in the Trash can still be held, so the hold and the project's Trash entry stay together.
      const trashed = p ? undefined : (await tx.query(`select name from core.trash where root_id = $1 and workspace_id = $2 and root_table = 'core.projects'`, [input.projectId, who.workspaceId])).rows[0]
      if (!p && !trashed) throw new ApiError(404, 'not_found', 'No such project.')
      scopeName = (p ?? trashed)!.name as string
    } else {
      scopeName = String((await tx.query(`select name from core.workspaces where id = $1`, [who.workspaceId])).rows[0].name)
    }
    const dup = (await tx.query(`select 1 from core.legal_holds where workspace_id = $1 and released_at is null and project_id is not distinct from $2`, [who.workspaceId, input.projectId ?? null])).rows[0]
    if (dup) throw new ApiError(409, 'already_held', 'That is already under a legal hold.')
    const made = (await tx.query(`insert into core.legal_holds (workspace_id, project_id, scope_name, reason, set_by) values ($1, $2, $3, $4, $5) returning id`, [who.workspaceId, input.projectId ?? null, scopeName, input.reason.trim(), who.userId])).rows[0]
    await audit(tx, who, 'hold placed', { id: made.id, project_id: input.projectId, scope_name: scopeName }, { reason: input.reason.trim() })
    return shape((await tx.query(`${SELECT} where h.id = $1`, [made.id])).rows[0])
  })
}

export async function releaseHold(db: Db, who: Actor, id: string): Promise<LegalHold> {
  return db.transaction(async (tx) => {
    const h = (await tx.query(`select id, project_id, scope_name from core.legal_holds where id = $1 and workspace_id = $2 and released_at is null for update`, [id, who.workspaceId])).rows[0]
    if (!h) throw new ApiError(404, 'not_found', 'No such hold, or it was already released.')
    await tx.query(`update core.legal_holds set released_at = now(), released_by = $2 where id = $1`, [id, who.userId])
    await audit(tx, who, 'hold released', h)
    return shape((await tx.query(`${SELECT} where h.id = $1`, [id])).rows[0])
  })
}

/** Refuses (409 legal_hold) when what is about to be deleted for good is under a hold: the workspace, or the project it belongs to. */
export async function assertNotHeld(db: Queryable, workspaceId: string, projectId: string | null): Promise<void> {
  const held = (await db.query(`select 1 from core.legal_holds where workspace_id = $1 and released_at is null and (project_id is null or ($2::uuid is not null and project_id = $2::uuid)) limit 1`, [workspaceId, projectId])).rows[0]
  if (held) throw new ApiError(409, 'legal_hold', 'This is under a legal hold, so it cannot be deleted for good. Release the hold first (Admin, Data).')
}

/** The project a Trash entry belongs to, if any: the project itself, or the project of a deleted document. */
export const trashProjectId = (e: { root_table: string; root_id: string; payload: any }): string | null => {
  if (e.root_table === 'core.projects') return e.root_id
  const payload = typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload
  return (payload?.tables?.[e.root_table]?.[0]?.project_id as string | undefined) ?? null
}

export type RetentionResult = { trashRemoved: number; auditRemoved: number; usageRemoved: number; notificationsCleared: number; paused: number }

/**
 * The cleanup, for every workspace at once (set-based, so it is a handful of statements): run by the hourly job, safe to run again. A workspace with a
 * legal hold is skipped for what the hold covers. `db` is the platform's own handle (the owner role), because it acts for no one workspace.
 */
export async function runRetention(db: Queryable, now: Date = new Date()): Promise<RetentionResult> {
  const cutoff = new Date(now)
  cutoff.setUTCMonth(cutoff.getUTCMonth() - AGE_MONTHS)
  const noHold = `not exists (select 1 from core.legal_holds h where h.workspace_id = X.workspace_id and h.released_at is null)`
  // Trash: 90 days are up, unless the workspace is held or the entry's project is.
  const trash = await db.query(
    `with gone as (
       delete from core.trash t
        where t.purge_at < $1
          and not exists (select 1 from core.legal_holds h where h.workspace_id = t.workspace_id and h.released_at is null
                           and (h.project_id is null or h.project_id = t.root_id or h.project_id::text = t.payload->'tables'->t.root_table->0->>'project_id'))
        returning t.workspace_id, t.root_table, t.root_id, t.name, t.kind)
     insert into core.audit_log (workspace_id, entity, entity_id, verb, before, after)
     select workspace_id, root_table, root_id, 'removed after 90 days', jsonb_build_object('name', name), jsonb_build_object('kind', kind) from gone returning 1`,
    [now],
  )
  const audit = await db.query(`with gone as (delete from core.audit_log X where X.created_at < $1 and ${noHold} returning 1) select count(*)::int as n from gone`, [cutoff])
  const usage = await db.query(`with gone as (delete from core.ai_usage X where X.created_at < $1 and ${noHold} returning 1) select count(*)::int as n from gone`, [cutoff])
  // Records of messages keep no content after a year; the row stays as the marker that it was sent, so nothing is ever sent twice.
  const notes = await db.query(
    `with done as (update core.notifications X set payload = '{}'::jsonb, error = null
                    where X.created_at < $1 and X.status in ('sent', 'failed') and (X.payload <> '{}'::jsonb or X.error is not null) and ${noHold} returning 1)
     select count(*)::int as n from done`,
    [cutoff],
  )
  await db.query(`update delivery.launch_slack_posts X set error = null where X.created_at < $1 and X.error is not null and ${noHold}`, [cutoff])
  const paused = await db.query(`select count(distinct workspace_id)::int as n from core.legal_holds where released_at is null`)
  return { trashRemoved: trash.rows.length, auditRemoved: audit.rows[0].n, usageRemoved: usage.rows[0].n, notificationsCleared: notes.rows[0].n, paused: paused.rows[0].n }
}
