// The Design step: for each requirement on the board, a link to its prototype, a thumbnail and the design notes. The requirements
// document's own "considered and rejected" list is shown once above the table.
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'
import { NoBoard, StoryNotFound } from './stories.js'
import type { Actor } from './versioning.js'

export type DesignItem = {
  storyId: string
  key: string
  title: string
  priority: 'low' | 'medium' | 'high'
  summary: string | null
  whyItMatters: string | null
  theme: { title: string; participantCount: number; totalParticipants: number } | null
  prototypeUrl: string | null
  notes: string | null
  hasImage: boolean
  /** 0 when nothing has been saved for this requirement yet. */
  version: number
}
export type Design = {
  specId: string
  specName: string
  projectId: string
  decisions: { reasoning: string | null; alternatives: { title: string; reason: string }[] }
  items: DesignItem[]
}
export class DesignConflict extends Error {
  constructor(public current: number) {
    super('design version conflict')
  }
}

const keyNumber = (key: string) => Number(key.replace(/\D/g, '')) || 0

const ITEM_SQL = `
  select s.id as story_id, s.key, s.title, s.priority, s.summary, s.why_it_matters,
         coalesce(o.title, t.title) as theme_title, st.participant_count::int as ppl, st.total_participants::int as total,
         d.prototype_url, d.notes, (d.image is not null) as has_image, coalesce(d.version, 0) as version
  from delivery.stories s
  left join research.themes t on t.id = s.theme_id
  left join research.theme_overrides o on o.theme_id = t.id
  left join research.theme_stats st on st.theme_id = t.id
  left join delivery.design_items d on d.story_id = s.id`

function toItem(r: Record<string, any>): DesignItem {
  return {
    storyId: r.story_id, key: r.key, title: r.title, priority: r.priority, summary: r.summary ?? null, whyItMatters: r.why_it_matters ?? null,
    theme: r.theme_title ? { title: r.theme_title, participantCount: r.ppl ?? 0, totalParticipants: r.total ?? 0 } : null,
    prototypeUrl: r.prototype_url ?? null, notes: r.notes ?? null, hasImage: !!r.has_image, version: r.version,
  }
}

export async function getDesign(db: Queryable, workspaceId: string, projectId: string): Promise<Design> {
  const spec = (
    await db.query(
      `select id, name, project_id, agent_run_id from delivery.specs where project_id = $1 and workspace_id = $2 and status = 'published' order by published_at desc limit 1`,
      [projectId, workspaceId],
    )
  ).rows[0]
  if (!spec) throw new NoBoard()
  const rows = (await db.query(`${ITEM_SQL} where s.spec_id = $1 and s.kind = 'requirement'`, [spec.id])).rows
  const step = spec.agent_run_id ? (await db.query(`select id, reasoning from core.agent_steps where run_id = $1 and key = 'requirements'`, [spec.agent_run_id])).rows[0] : undefined
  const alternatives = step ? (await db.query(`select title, reason from core.agent_step_alternatives where step_id = $1 order by position`, [step.id])).rows : []
  return {
    specId: spec.id, specName: spec.name, projectId: spec.project_id,
    decisions: { reasoning: step?.reasoning ?? null, alternatives: alternatives.map((a) => ({ title: a.title, reason: a.reason })) },
    items: rows.map(toItem).sort((a, b) => keyNumber(a.key) - keyNumber(b.key)),
  }
}

export async function getDesignItem(db: Queryable, workspaceId: string, storyId: string): Promise<DesignItem | undefined> {
  const r = (await db.query(`${ITEM_SQL} where s.id = $1 and s.workspace_id = $2 and s.kind = 'requirement'`, [storyId, workspaceId])).rows[0]
  return r ? toItem(r) : undefined
}

export type DesignInput = {
  prototypeUrl: string | null
  notes: string | null
  /** Undefined keeps the picture, null removes it, a value replaces it. */
  image?: { type: 'image/jpeg' | 'image/png' | 'image/webp'; data: Buffer } | null
}

// Saves what is on screen for one requirement against the version the person was looking at (0 when nothing was saved yet).
export async function saveDesignItem(db: Db, ctx: Actor, storyId: string, expected: number, input: DesignInput): Promise<void> {
  await db.transaction(async (tx) => {
    const story = (await tx.query(`select id from delivery.stories where id = $1 and workspace_id = $2 and kind = 'requirement' for update`, [storyId, ctx.workspaceId])).rows[0]
    if (!story) throw new StoryNotFound()
    const row = (await tx.query(`select id, version from delivery.design_items where story_id = $1 for update`, [storyId])).rows[0]
    const current = row?.version ?? 0
    if (current !== expected) throw new DesignConflict(current)
    if (!row) {
      await tx.query(
        `insert into delivery.design_items (workspace_id, story_id, prototype_url, notes, image, image_type, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $7)`,
        [ctx.workspaceId, storyId, input.prototypeUrl, input.notes, input.image?.data ?? null, input.image?.type ?? null, ctx.userId],
      )
    } else if (input.image === undefined) {
      await tx.query(`update delivery.design_items set prototype_url = $2, notes = $3, updated_by = $4 where id = $1`, [row.id, input.prototypeUrl, input.notes, ctx.userId])
    } else {
      await tx.query(`update delivery.design_items set prototype_url = $2, notes = $3, image = $4, image_type = $5, updated_by = $6 where id = $1`, [row.id, input.prototypeUrl, input.notes, input.image?.data ?? null, input.image?.type ?? null, ctx.userId])
    }
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'delivery.design_items', entity_id: storyId, verb: row ? 'updated' : 'created' }])
  })
}

export async function getDesignImage(db: Queryable, workspaceId: string, storyId: string): Promise<{ type: string; data: Buffer } | undefined> {
  const r = (
    await db.query(`select d.image, d.image_type from delivery.design_items d where d.story_id = $1 and d.workspace_id = $2 and d.image is not null`, [storyId, workspaceId])
  ).rows[0]
  return r ? { type: r.image_type, data: Buffer.from(r.image) } : undefined
}
