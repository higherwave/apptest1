// The Measure step: for each requirement on the board, how we will know it worked and what the check-ins since have shown. The newest
// check-in's verdict is the requirement's result; the project's result is the count of each.
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'
import { NoBoard, StoryNotFound } from './stories.js'
import type { Actor } from './versioning.js'

export type Verdict = 'worked' | 'needs_attention' | 'too_early'
export type MeasureSource = 'telemetry' | 'kpi' | 'support_tickets' | 'research' | 'other'
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
  /** Oldest first. */
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
  select s.id as story_id, s.key, s.title, s.priority, s.summary, s.why_it_matters,
         m.metric, m.source, m.baseline, m.target, coalesce(m.checkins, '[]'::jsonb) as checkins, coalesce(m.version, 0) as version
  from delivery.stories s
  left join delivery.success_measures m on m.story_id = s.id`

function toItem(r: Record<string, any>): MeasureItem {
  const checkins: Checkin[] = (Array.isArray(r.checkins) ? r.checkins : []).map((c: any) => ({ on: c.on, value: c.value ?? '', verdict: c.verdict, note: c.note ?? null }))
  return {
    storyId: r.story_id, key: r.key, title: r.title, priority: r.priority, summary: r.summary ?? null, whyItMatters: r.why_it_matters ?? null,
    metric: r.metric ?? null, source: r.source ?? null, baseline: r.baseline ?? null, target: r.target ?? null,
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

export async function getMeasureItem(db: Queryable, workspaceId: string, storyId: string): Promise<MeasureItem | undefined> {
  const r = (await db.query(`${ITEM_SQL} where s.id = $1 and s.workspace_id = $2 and s.kind = 'requirement'`, [storyId, workspaceId])).rows[0]
  return r ? toItem(r) : undefined
}

export type MeasureInput = { metric: string | null; source: MeasureSource | null; baseline: string | null; target: string | null; checkins: Checkin[] }

// Saves what is on screen for one requirement against the version the person was looking at (0 when nothing was saved yet).
export async function saveMeasureItem(db: Db, ctx: Actor, storyId: string, expected: number, input: MeasureInput): Promise<void> {
  await db.transaction(async (tx) => {
    const story = (await tx.query(`select id from delivery.stories where id = $1 and workspace_id = $2 and kind = 'requirement' for update`, [storyId, ctx.workspaceId])).rows[0]
    if (!story) throw new StoryNotFound()
    const row = (await tx.query(`select id, version from delivery.success_measures where story_id = $1 for update`, [storyId])).rows[0]
    const current = row?.version ?? 0
    if (current !== expected) throw new MeasureConflict(current)
    const checkins = JSON.stringify(input.checkins)
    if (!row) {
      await tx.query(
        `insert into delivery.success_measures (workspace_id, story_id, metric, source, baseline, target, checkins, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)`,
        [ctx.workspaceId, storyId, input.metric, input.source, input.baseline, input.target, checkins, ctx.userId],
      )
    } else {
      await tx.query(`update delivery.success_measures set metric = $2, source = $3, baseline = $4, target = $5, checkins = $6::jsonb, updated_by = $7 where id = $1`, [row.id, input.metric, input.source, input.baseline, input.target, checkins, ctx.userId])
    }
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'delivery.success_measures', entity_id: storyId, verb: row ? 'updated' : 'created' }])
  })
}
