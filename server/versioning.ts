import type { Queryable } from './db.js'

export type Actor = { workspaceId: string; userId: string }

export class VersionConflict extends Error {
  constructor(public current: number) {
    super('version conflict')
  }
}
export class ProjectNotFound extends Error {}

// Compare-and-set on the project's version: the save applies only if nobody changed the project since the version
// the person was looking at. The update also bumps the version (a trigger does it).
export async function claimVersion(tx: Queryable, ctx: Actor, projectId: string, expected: number, name?: string): Promise<void> {
  const r = await tx.query(
    `update core.projects set updated_by = $3, name = coalesce($5, name) where id = $1 and workspace_id = $4 and kind = 'research' and version = $2 returning version`,
    [projectId, expected, ctx.userId, ctx.workspaceId, name ?? null],
  )
  if (r.rows[0]) return
  const cur = await tx.query(`select version from core.projects where id = $1 and workspace_id = $2 and kind = 'research'`, [projectId, ctx.workspaceId])
  if (!cur.rows[0]) throw new ProjectNotFound()
  throw new VersionConflict(cur.rows[0].version as number)
}
