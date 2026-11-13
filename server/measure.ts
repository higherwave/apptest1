// Measure: for each requirement on a project's published board, how we will know it worked and what the check-ins since have shown. The newest
// check-in's verdict is the requirement's result; the project's result is the count of each. Measure is a place of its own, across every project the
// caller can see (getMeasureAcross), and can be narrowed to one project; the rows are still written one requirement at a time.
import { compatFields } from '../shared/measure.mjs'
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'
import { NoBoard, StoryNotFound } from './stories.js'
import type { Actor } from './versioning.js'

export type Verdict = 'worked' | 'needs_attention' | 'too_early'
export type MeasureSource = 'telemetry' | 'kpi' | 'support_tickets' | 'research' | 'other'
export type MeasureKind = 'tickets' | 'adoption' | 'engagement' | 'time_to_value' | 'retention' | 'feedback' | 'other'
export type MeasureComparison = 'change' | 'below' | 'above' | 'between' | 'reach'
export type Checkin = { on: string; value: string; verdict: Verdict; note: string | null }
export type MeasureItem = {
  storyId: string
  key: string
  title: string
  priority: 'low' | 'medium' | 'high'
  summary: string | null
  whyItMatters: string | null
  metric: string | null
  source: MeasureSource | null
  baseline: string | null
  target: string | null
  /** The measure as one sentence: what, the detail, how it is compared and the values. Null on a row saved before the sentence existed. */
  metricKind: MeasureKind | null
  detail: string | null
  comparison: MeasureComparison | null
  valueA: string | null
  valueB: string | null
  unit: string | null
  /** A short series of readings, oldest first, for a small chart; sample data in the demo until a data source is connected. */
  trend: number[] | null
  /** Today a requirement has one reading: the latest, with its status. Oldest first. */
  checkins: Checkin[]
  /** The newest check-in's verdict, or null before the first one. */
  result: Verdict | null
  /** 0 when nothing has been saved for this requirement yet. */
  version: number
}
export type Measure = {
  specId: string
  specName: string
  projectId: string
  summary: { total: number; worked: number; needsAttention: number; tooEarly: number; notMeasured: number }
  items: MeasureItem[]
}
export class MeasureConflict extends Error {
  constructor(public current: number) {
    super('measure version conflict')
  }
}

const keyNumber = (key: string) => Number(key.replace(/\D/g, '')) || 0

const ITEM_SQL = `
  select s.id as story_id, s.spec_id, s.key, s.title, s.priority, s.summary, s.why_it_matters,
         m.metric, m.source, m.baseline, m.target, m.metric_kind, m.detail, m.comparison, m.value_a, m.value_b, m.unit, m.trend,
         coalesce(m.checkins, '[]'::jsonb) as checkins, coalesce(m.version, 0) as version
  from delivery.stories s
  left join delivery.success_measures m on m.story_id = s.id`

function toItem(r: Record<string, any>): MeasureItem {
  const checkins: Checkin[] = (Array.isArray(r.checkins) ? r.checkins : []).map((c: any) => ({ on: c.on, value: c.value ?? '', verdict: c.verdict, note: c.note ?? null }))
  return {
    storyId: r.story_id, key: r.key, title: r.title, priority: r.priority, summary: r.summary ?? null, whyItMatters: r.why_it_matters ?? null,
    metric: r.metric ?? null, source: r.source ?? null, baseline: r.baseline ?? null, target: r.target ?? null,
    metricKind: r.metric_kind ?? null, detail: r.detail ?? null, comparison: r.comparison ?? null, valueA: r.value_a ?? null, valueB: r.value_b ?? null, unit: r.unit ?? null,
    trend: Array.isArray(r.trend) ? r.trend.map(Number).filter((n: number) => Number.isFinite(n)) : null,
    checkins, result: checkins.length ? checkins[checkins.length - 1].verdict : null, version: r.version,
  }
}

export async function getMeasure(db: Queryable, workspaceId: string, projectId: string): Promise<Measure> {
  const spec = (
    await db.query(
      `select id, name, project_id from delivery.specs where project_id = $1 and workspace_id = $2 and status = 'published' order by published_at desc limit 1`,
      [projectId, workspaceId],
    )
  ).rows[0]
  if (!spec) throw new NoBoard()
  const rows = (await db.query(`${ITEM_SQL} where s.spec_id = $1 and s.kind = 'requirement'`, [spec.id])).rows
  const items = rows.map(toItem).sort((a, b) => keyNumber(a.key) - keyNumber(b.key))
  const count = (v: Verdict) => items.filter((i) => i.result === v).length
  return {
    specId: spec.id, specName: spec.name, projectId: spec.project_id,
    summary: { total: items.length, worked: count('worked'), needsAttention: count('needs_attention'), tooEarly: count('too_early'), notMeasured: items.filter((i) => !i.result).length },
    items,
  }
}

export type MeasureAcrossItem = MeasureItem & { projectId: string; projectName: string; teamId: string | null; teamName: string | null; canEdit: boolean }
export type MeasureAcross = {
  /** Every project with a published requirements document that the caller can see, by name. */
  projects: { id: string; name: string; teamId: string | null; teamName: string | null; canEdit: boolean }[]
  items: MeasureAcrossItem[]
}

/**
 * The measures of every visible project's latest published requirements document, by project name and then requirement. `visible` is the caller's
 * team ids (null: every team); `editable` the teams they may write in, so a screen can show which rows are read-only for them.
 */
export async function getMeasureAcross(db: Queryable, workspaceId: string, visible: string[] | null, editable: string[]): Promise<MeasureAcross> {
  const params: unknown[] = [workspaceId]
  let scope = ''
  if (visible) {
    params.push(visible)
    scope = ` and p.team_id = any($2::uuid[])`
  }
  const specs = (
    await db.query(
      `select distinct on (sp.project_id) sp.id as spec_id, sp.project_id, p.name as project_name, p.team_id, t.name as team_name
         from delivery.specs sp
         join core.projects p on p.id = sp.project_id
         left join core.teams t on t.id = p.team_id
        where sp.workspace_id = $1 and sp.status = 'published' and p.kind = 'research'${scope}
        order by sp.project_id, sp.published_at desc`,
      params,
    )
  ).rows
  const projects = specs
    .map((s) => ({ id: s.project_id as string, name: s.project_name as string, teamId: (s.team_id ?? null) as string | null, teamName: (s.team_name ?? null) as string | null, canEdit: !!s.team_id && editable.includes(s.team_id) }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  if (!specs.length) return { projects, items: [] }
  const rows = (await db.query(`${ITEM_SQL} where s.spec_id = any($1::uuid[]) and s.kind = 'requirement'`, [specs.map((s) => s.spec_id)])).rows
  const byProject = new Map(specs.map((s) => [s.spec_id as string, projects.find((p) => p.id === s.project_id)!]))
  const items: MeasureAcrossItem[] = rows.map((r) => {
    const p = byProject.get(r.spec_id)!
    return { ...toItem(r), projectId: p.id, projectName: p.name, teamId: p.teamId, teamName: p.teamName, canEdit: p.canEdit }
  })
  const order = new Map(projects.map((p, i) => [p.id, i]))
  items.sort((a, b) => order.get(a.projectId)! - order.get(b.projectId)! || keyNumber(a.key) - keyNumber(b.key))
  return { projects, items }
}

export async function getMeasureItem(db: Queryable, workspaceId: string, storyId: string): Promise<MeasureItem | undefined> {
  const r = (await db.query(`${ITEM_SQL} where s.id = $1 and s.workspace_id = $2 and s.kind = 'requirement'`, [storyId, workspaceId])).rows[0]
  return r ? toItem(r) : undefined
}

export type MeasureInput = {
  metric: string | null
  source: MeasureSource | null
  baseline: string | null
  target: string | null
  metricKind: MeasureKind | null
  detail: string | null
  comparison: MeasureComparison | null
  valueA: string | null
  valueB: string | null
  unit: string | null
  checkins: Checkin[]
}

// Saves what is on screen for one requirement against the version the person was looking at (0 when nothing was saved yet).
export async function saveMeasureItem(db: Db, ctx: Actor, storyId: string, expected: number, input: MeasureInput): Promise<void> {
  await db.transaction(async (tx) => {
    const story = (await tx.query(`select id from delivery.stories where id = $1 and workspace_id = $2 and kind = 'requirement' for update`, [storyId, ctx.workspaceId])).rows[0]
    if (!story) throw new StoryNotFound()
    const row = (await tx.query(`select id, version from delivery.success_measures where story_id = $1 for update`, [storyId])).rows[0]
    const current = row?.version ?? 0
    if (current !== expected) throw new MeasureConflict(current)
    const checkins = JSON.stringify(input.checkins)
    // With the sentence's parts, the plain metric, baseline and target are written from them, so Platform Insights, the case studies and the counts keep reading what they always read.
    const written = compatFields(input) ?? { metric: input.metric, baseline: input.baseline, target: input.target }
    const parts = input.metricKind ? [input.metricKind, input.detail, input.comparison, input.valueA, input.valueB, input.unit] : [null, null, null, null, null, null]
    if (!row) {
      await tx.query(
        `insert into delivery.success_measures (workspace_id, story_id, metric, source, baseline, target, checkins, created_by, updated_by, metric_kind, detail, comparison, value_a, value_b, unit)
         values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8, $9, $10, $11, $12, $13, $14)`,
        [ctx.workspaceId, storyId, written.metric, input.source, written.baseline, written.target, checkins, ctx.userId, ...parts],
      )
    } else {
      await tx.query(
        `update delivery.success_measures set metric = $2, source = $3, baseline = $4, target = $5, checkins = $6::jsonb, updated_by = $7,
                metric_kind = $8, detail = $9, comparison = $10, value_a = $11, value_b = $12, unit = $13 where id = $1`,
        [row.id, written.metric, input.source, written.baseline, written.target, checkins, ctx.userId, ...parts],
      )
    }
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'delivery.success_measures', entity_id: storyId, verb: row ? 'updated' : 'created' }])
  })
}
