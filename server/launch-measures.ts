// A launch's expectations: how the release will be judged, as a short list of rolled-up measures (adoption, engagement, time-to-value, ...) rather than one per
// requirement. Each is the one-sentence measure of shared/measure.mjs. The requirements a measure covers are an optional note. The list is replaced as a whole and can
// change until the final decision is "go" (or "go with conditions"); after that it is the record of what was expected. The launch's `measures_version` is the
// version a save is checked against.
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'

export type LaunchMeasureKind = 'tickets' | 'adoption' | 'engagement' | 'time_to_value' | 'retention' | 'feedback' | 'other'
export type LaunchMeasureComparison = 'change' | 'below' | 'above' | 'between' | 'reach'
export type LaunchMeasure = {
  id: string
  metricKind: LaunchMeasureKind
  detail: string | null
  comparison: LaunchMeasureComparison
  valueA: string | null
  valueB: string | null
  unit: string | null
  /** Keys of the requirements it covers (R1, R2, ...); empty when it is about the release as a whole. */
  requirementKeys: string[]
  /** The readings taken since launch, oldest first. The newest is the result. */
  checkins: Reading[]
  /** The newest reading's verdict, or null before the first. */
  result: Reading['verdict'] | null
}
export type Reading = { on: string; value: string; verdict: 'worked' | 'needs_attention' | 'too_early'; note: string | null }
export type LaunchMeasureInput = Omit<LaunchMeasure, 'id' | 'checkins' | 'result'> & { id?: string | null }

export class MeasuresLocked extends Error {}
export class NotLaunched extends Error {}
export class MeasureNotFound extends Error {}
export class MeasuresConflict extends Error {
  constructor(public current: number) {
    super('launch measures version conflict')
  }
}

/** True once the final decision is a go: the expectations are then fixed. A launch with no go yet, a no-go, or a decision reopened by a changed brief can still change them. */
export const measuresLocked = (finalState: string) => finalState === 'go' || finalState === 'go_with_conditions'

export async function getLaunchMeasures(db: Queryable, launchId: string): Promise<{ version: number; items: LaunchMeasure[] }> {
  const version = Number((await db.query(`select measures_version from delivery.launches where id = $1`, [launchId])).rows[0]?.measures_version ?? 0)
  const rows = (await db.query(`select id, metric_kind, detail, comparison, value_a, value_b, unit, requirement_keys, checkins from delivery.launch_measures where launch_id = $1 order by position`, [launchId])).rows
  return {
    version,
    items: rows.map((r) => {
      const checkins: Reading[] = (Array.isArray(r.checkins) ? r.checkins : []).map((c: any) => ({ on: c.on, value: c.value ?? '', verdict: c.verdict, note: c.note ?? null }))
      return { id: r.id, metricKind: r.metric_kind, detail: r.detail ?? null, comparison: r.comparison, valueA: r.value_a ?? null, valueB: r.value_b ?? null, unit: r.unit ?? null, requirementKeys: r.requirement_keys ?? [], checkins, result: checkins.length ? checkins[checkins.length - 1].verdict : null }
    }),
  }
}

/**
 * Replaces the launch's list of measures with `items` (in that order) against the version the person was looking at. `finalState` is the launch's final-decision
 * state now, so a launch already given the go cannot be changed. A measure that arrives with an id of this launch keeps it.
 */
export async function saveLaunchMeasures(db: Db, ctx: RequestContext, launchId: string, expected: number, finalState: string, items: LaunchMeasureInput[]): Promise<void> {
  if (measuresLocked(finalState)) throw new MeasuresLocked()
  await db.transaction(async (tx) => {
    const row = (await tx.query(`select name, measures_version from delivery.launches where id = $1 and workspace_id = $2 for update`, [launchId, ctx.workspaceId])).rows[0]
    if (!row) throw new MeasuresConflict(0)
    if (Number(row.measures_version) !== expected) throw new MeasuresConflict(Number(row.measures_version))
    const before = (await getLaunchMeasures(tx, launchId)).items
    const known = new Set(before.map((m) => m.id))
    const readings = new Map(before.map((m) => [m.id, JSON.stringify(m.checkins)]))
    await tx.query(`delete from delivery.launch_measures where launch_id = $1`, [launchId])
    let position = 0
    for (const m of items) {
      const keep = m.id && known.has(m.id) ? m.id : null
      await tx.query(
        `insert into delivery.launch_measures (id, workspace_id, launch_id, position, metric_kind, detail, comparison, value_a, value_b, unit, requirement_keys, checkins, created_by, updated_by)
         values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $13)`,
        [keep, ctx.workspaceId, launchId, position++, m.metricKind, m.detail, m.comparison, m.valueA, m.valueB, m.unit, m.requirementKeys, keep ? readings.get(keep) : '[]', ctx.userId],
      )
    }
    await tx.query(`update delivery.launches set measures_version = measures_version + 1, updated_by = $2 where id = $1`, [launchId, ctx.userId])
    const brief = (list: { metricKind: string; detail: string | null }[]) => list.map((m) => [m.metricKind, m.detail ?? ''].join(': '))
    await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'delivery.launches', $3, 'expectations changed', $4, $5)`, [
      ctx.workspaceId, ctx.userId, launchId, JSON.stringify({ launch: row.name, measures: brief(before) }), JSON.stringify({ launch: row.name, measures: brief(items) }),
    ])
  })
}

/**
 * Records a reading on one measure, after the launch has the final go. A reading for a day already read replaces it; otherwise it is added, so the history is kept and the
 * newest day is the result. `finalState` is the launch's final-decision state now.
 */
export async function saveReading(db: Db, ctx: RequestContext, launchId: string, measureId: string, finalState: string, reading: Reading): Promise<void> {
  if (!measuresLocked(finalState)) throw new NotLaunched()
  await db.transaction(async (tx) => {
    const row = (await tx.query(`select m.id, m.checkins, m.metric_kind, l.name from delivery.launch_measures m join delivery.launches l on l.id = m.launch_id where m.id = $1 and m.launch_id = $2 and m.workspace_id = $3 for update of m`, [measureId, launchId, ctx.workspaceId])).rows[0]
    if (!row) throw new MeasureNotFound()
    const list: Reading[] = (Array.isArray(row.checkins) ? row.checkins : []).filter((c: Reading) => c.on !== reading.on)
    list.push(reading)
    list.sort((a, b) => a.on.localeCompare(b.on))
    await tx.query(`update delivery.launch_measures set checkins = $2::jsonb, updated_by = $3 where id = $1`, [measureId, JSON.stringify(list.slice(-60)), ctx.userId])
    await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'delivery.launches', $3, 'reading recorded', null, $4)`, [
      ctx.workspaceId, ctx.userId, launchId, JSON.stringify({ launch: row.name, measure: row.metric_kind, on: reading.on, verdict: reading.verdict }),
    ])
  })
}

export type ProjectMeasures = { launchId: string; items: LaunchMeasure[] }

/** The launch's measures of a project (it has one launch), or null when it has no launch. */
export async function getProjectMeasures(db: Queryable, workspaceId: string, projectId: string): Promise<ProjectMeasures | null> {
  const l = (await db.query(`select id from delivery.launches where project_id = $1 and workspace_id = $2`, [projectId, workspaceId])).rows[0]
  return l ? { launchId: l.id as string, items: (await getLaunchMeasures(db, l.id)).items } : null
}

const RANK = { needs_attention: 3, worked: 2, too_early: 1 } as const
/**
 * What the launches' measures say about each requirement: for every project, requirement key to the strongest result among the measures that cover it. Needs attention
 * outranks worked, which outranks too early. A measure that names requirements is about those; one that names none is about the release as a whole, and speaks only for a
 * requirement that no measure names (a requirement with its own measure is judged by that, read or not). A requirement with no read measure has no entry.
 */
export async function requirementResults(db: Queryable, workspaceId: string, projectIds: string[], requirementKeys: Map<string, string[]>): Promise<Map<string, Map<string, Reading['verdict']>>> {
  const out = new Map<string, Map<string, Reading['verdict']>>()
  if (!projectIds.length) return out
  const rows = (
    await db.query(
      `select l.project_id, m.requirement_keys, m.checkins
         from delivery.launch_measures m join delivery.launches l on l.id = m.launch_id
        where l.workspace_id = $1 and l.project_id = any($2::uuid[])`,
      [workspaceId, projectIds],
    )
  ).rows
  const named = new Map<string, Set<string>>()
  for (const r of rows) for (const k of (r.requirement_keys ?? []) as string[]) named.set(r.project_id, (named.get(r.project_id) ?? new Set<string>()).add(k))
  for (const r of rows) {
    const checkins: Reading[] = Array.isArray(r.checkins) ? r.checkins : []
    const verdict = checkins[checkins.length - 1]?.verdict
    if (!verdict) continue
    const covered: string[] = r.requirement_keys?.length ? r.requirement_keys : (requirementKeys.get(r.project_id) ?? []).filter((k) => !named.get(r.project_id)?.has(k))
    const byKey = out.get(r.project_id) ?? new Map<string, Reading['verdict']>()
    for (const k of covered) {
      const had = byKey.get(k)
      if (!had || RANK[verdict] > RANK[had]) byKey.set(k, verdict)
    }
    out.set(r.project_id, byKey)
  }
  return out
}
