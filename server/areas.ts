// Feature areas: the workspace's shared list of what research is about. An editor adds an area (after a duplicate check); an owner
// edits, merges and retires them. The matching words are in shared/areas.ts so the screens and the API agree about what a duplicate is.
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { similarAreas, type AreaLike } from '../shared/areas.js'

export type Area = {
  id: string
  name: string
  definition: string | null
  aliases: string[]
  retired: boolean
  /** The area this one was merged into, when it was. */
  mergedInto: string | null
  usage: { tasks: number }
  version: number
}

export class AreaMissing extends Error {}
export class AreaConflict extends Error {
  constructor(public current: number) {
    super('area version conflict')
  }
}
/** The name is the same as, or an alias of, an area that exists: use that one. */
export class AreaDuplicate extends Error {
  constructor(public existing: { id: string; name: string }) {
    super(`"${existing.name}" already exists.`)
  }
}
/** The name looks like areas that exist; the person may still add it on purpose. */
export class AreaSimilar extends Error {
  constructor(public similar: { id: string; name: string; reason: string }[]) {
    super('similar areas exist')
  }
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const cleanAliases = (aliases: string[], name: string) => [...new Map(aliases.map(clean).filter((a) => a && a.toLowerCase() !== name.toLowerCase()).map((a) => [a.toLowerCase(), a])).values()]
const audit = (tx: Queryable, ctx: RequestContext, verb: string, id: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'insights.feature_areas', $3, $4, $5, $6)`, [
    ctx.workspaceId, ctx.userId, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

const AREA_SQL = `
  select a.id, a.name, a.definition, a.aliases, a.retired_at, a.merged_into, a.version,
         (select count(*)::int from research.tasks t where t.area_id = a.id) as tasks
  from insights.feature_areas a`

const toArea = (r: Record<string, any>): Area => ({
  id: r.id, name: r.name, definition: r.definition ?? null, aliases: r.aliases ?? [], retired: !!r.retired_at, mergedInto: r.merged_into ?? null,
  usage: { tasks: r.tasks ?? 0 }, version: r.version,
})

/** Every area, active first (alphabetical), then retired ones. */
export async function listAreas(db: Queryable, workspaceId: string): Promise<Area[]> {
  const rows = (await db.query(`${AREA_SQL} where a.workspace_id = $1 order by (a.retired_at is not null), lower(a.name)`, [workspaceId])).rows
  return rows.map(toArea)
}

async function getArea(db: Queryable, workspaceId: string, id: string): Promise<Area | undefined> {
  const r = (await db.query(`${AREA_SQL} where a.workspace_id = $1 and a.id = $2`, [workspaceId, id])).rows[0]
  return r ? toArea(r) : undefined
}

const active = (areas: Area[]): AreaLike[] => areas.filter((a) => !a.retired)

/**
 * Adds an area. The same name or an alias of an existing area is refused (AreaDuplicate: use it). A name that only looks like one is
 * refused unless `force` says the person meant it (AreaSimilar lists what it resembles).
 */
export async function createArea(db: Db, ctx: RequestContext, input: { name: string; definition: string | null; aliases: string[]; force: boolean }): Promise<Area> {
  const name = clean(input.name)
  return db.transaction(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`feature-areas:${ctx.workspaceId}`])
    const existing = active(await listAreas(tx, ctx.workspaceId))
    const found = similarAreas(name, existing)
    const exact = found.find((f) => f.reason !== 'similar')
    if (exact) throw new AreaDuplicate({ id: exact.area.id, name: exact.area.name })
    if (found.length && !input.force) throw new AreaSimilar(found.map((f) => ({ id: f.area.id, name: f.area.name, reason: f.reason })))
    const row = (
      await tx.query(
        `insert into insights.feature_areas (workspace_id, name, definition, aliases, created_by, updated_by) values ($1, $2, $3, $4, $5, $5) returning id`,
        [ctx.workspaceId, name, input.definition ? clean(input.definition) : null, cleanAliases(input.aliases, name), ctx.userId],
      )
    ).rows[0]
    const made = (await getArea(tx, ctx.workspaceId, row.id))!
    await audit(tx, ctx, 'created', made.id, null, { name: made.name })
    return made
  })
}

/** Changes the name, definition and aliases (owners). The old name stays as an alias, so it is still recognised. */
export async function updateArea(db: Db, ctx: RequestContext, id: string, expected: number, input: { name: string; definition: string | null; aliases: string[] }): Promise<Area> {
  const name = clean(input.name)
  return db.transaction(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`feature-areas:${ctx.workspaceId}`])
    const before = await getArea(tx, ctx.workspaceId, id)
    if (!before) throw new AreaMissing()
    if (before.version !== expected) throw new AreaConflict(before.version)
    const others = active(await listAreas(tx, ctx.workspaceId)).filter((a) => a.id !== id)
    const clash = similarAreas(name, others).find((f) => f.reason !== 'similar')
    if (clash) throw new AreaDuplicate({ id: clash.area.id, name: clash.area.name })
    const aliases = cleanAliases([...input.aliases, ...(before.name.toLowerCase() !== name.toLowerCase() ? [before.name] : [])], name)
    await tx.query(`update insights.feature_areas set name = $3, definition = $4, aliases = $5, updated_by = $6 where workspace_id = $1 and id = $2`, [
      ctx.workspaceId, id, name, input.definition ? clean(input.definition) : null, aliases, ctx.userId,
    ])
    const after = (await getArea(tx, ctx.workspaceId, id))!
    await audit(tx, ctx, 'edited', id, { name: before.name, definition: before.definition, aliases: before.aliases }, { name: after.name, definition: after.definition, aliases: after.aliases })
    return after
  })
}

/** Takes an area off the picker. What already uses it keeps it, and it can still be read. Owners. */
export async function retireArea(db: Db, ctx: RequestContext, id: string): Promise<Area> {
  return db.transaction(async (tx) => {
    const before = await getArea(tx, ctx.workspaceId, id)
    if (!before) throw new AreaMissing()
    await tx.query(`update insights.feature_areas set retired_at = coalesce(retired_at, now()), updated_by = $3 where workspace_id = $1 and id = $2`, [ctx.workspaceId, id, ctx.userId])
    await audit(tx, ctx, 'retired', id, { name: before.name }, null)
    return (await getArea(tx, ctx.workspaceId, id))!
  })
}

/** Folds an area into another: its questions and tasks move, its name and aliases become aliases of the target, and it is retired. Owners. */
export async function mergeAreas(db: Db, ctx: RequestContext, id: string, intoId: string): Promise<Area> {
  if (id === intoId) throw new AreaConflict(0)
  return db.transaction(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`feature-areas:${ctx.workspaceId}`])
    const from = await getArea(tx, ctx.workspaceId, id)
    const into = await getArea(tx, ctx.workspaceId, intoId)
    if (!from || !into || into.retired) throw new AreaMissing()
    await tx.query(`update research.tasks set area_id = $2 where area_id = $1 and workspace_id = $3`, [id, intoId, ctx.workspaceId])
    await tx.query(`update insights.feature_areas set aliases = $3, updated_by = $4 where workspace_id = $1 and id = $2`, [ctx.workspaceId, intoId, cleanAliases([...into.aliases, from.name, ...from.aliases], into.name), ctx.userId])
    await tx.query(`update insights.feature_areas set retired_at = now(), merged_into = $3, updated_by = $4 where workspace_id = $1 and id = $2`, [ctx.workspaceId, id, intoId, ctx.userId])
    await audit(tx, ctx, 'merged', id, { name: from.name, usage: from.usage }, { into: into.name })
    return (await getArea(tx, ctx.workspaceId, intoId))!
  })
}

/** Throws if any id is not a live (not retired) area of this workspace. Used before a task or test item is saved with an area. */
export async function assertAreasUsable(db: Queryable, workspaceId: string, ids: (string | null | undefined)[], alreadyAssigned: Set<string> = new Set()): Promise<void> {
  const wanted = [...new Set(ids.filter((i): i is string => !!i))]
  if (!wanted.length) return
  const rows = (await db.query(`select id, retired_at from insights.feature_areas where workspace_id = $1 and id = any($2::uuid[])`, [workspaceId, wanted])).rows
  for (const id of wanted) {
    const row = rows.find((r) => r.id === id)
    if (!row || (row.retired_at && !alreadyAssigned.has(id))) throw new AreaMissing()
  }
}
