import { COLUMNS, positionFor, renumber } from '../shared/board.mjs'
import type { Db, Queryable } from './db.js'
import { ApiError } from './errors.js'
import { insertMany } from './sql.js'
import type { Actor } from './versioning.js'

export type StoryStatus = (typeof COLUMNS)[number]
export type BoardStory = {
  id: string
  key: string
  kind: 'requirement' | 'open_question'
  title: string
  status: StoryStatus
  position: number
  priority: 'low' | 'medium' | 'high'
  ownerTeam: string | null
  summary: string | null
  whyItMatters: string | null
  nextStep: string | null
  /** Set when the document no longer agrees with this story (see "Update board"). */
  syncNote: string | null
  theme: { id: string; title: string; category: string; participantCount: number; totalParticipants: number } | null
  criteriaMet: number
  criteriaTotal: number
  version: number
}
export type ChecklistItem = { id: string; kind: 'criterion' | 'task'; text: string; met: boolean; position: number }
export type StoryDetail = BoardStory & { specId: string; checklist: ChecklistItem[] }
export type LastMove = { storyId: string; key: string; title: string; from: StoryStatus; to: StoryStatus }
export type Board = {
  specId: string
  specName: string
  projectId: string
  projectName: string
  stories: BoardStory[]
  themes: { id: string; title: string; count: number }[]
  lastMove: LastMove | null
}

export class NoBoard extends Error {}
export class StoryNotFound extends Error {}
export class StoryVersionConflict extends Error {
  constructor(public current: number) {
    super('story version conflict')
  }
}
export class NothingToUndo extends Error {}
export class CannotUndo extends Error {}

const STORY_SQL = `
  select s.id, s.spec_id, s.key, s.kind, s.title, s.status, s.position::float8 as position, s.priority, s.owner_team, s.summary, s.why_it_matters, s.next_step, s.sync_note, s.version,
         t.id as theme_id, coalesce(o.title, t.title) as theme_title, t.category as theme_category, st.participant_count::int as ppl, st.total_participants::int as total,
         (select count(*)::int from delivery.story_checklist c where c.story_id = s.id and c.kind = 'criterion') as criteria_total,
         (select count(*)::int from delivery.story_checklist c where c.story_id = s.id and c.kind = 'criterion' and c.met) as criteria_met
  from delivery.stories s
  left join research.themes t on t.id = s.theme_id
  left join research.theme_overrides o on o.theme_id = t.id
  left join research.theme_stats st on st.theme_id = t.id`

function toStory(r: Record<string, any>): BoardStory {
  return {
    id: r.id, key: r.key, kind: r.kind, title: r.title, status: r.status, position: Number(r.position), priority: r.priority, ownerTeam: r.owner_team ?? null,
    summary: r.summary ?? null, whyItMatters: r.why_it_matters ?? null, nextStep: r.next_step ?? null, syncNote: r.sync_note ?? null,
    theme: r.theme_id ? { id: r.theme_id, title: r.theme_title, category: r.theme_category, participantCount: r.ppl ?? 0, totalParticipants: r.total ?? 0 } : null,
    criteriaMet: r.criteria_met, criteriaTotal: r.criteria_total, version: r.version,
  }
}

// The board of a project: its most recently published document's stories. `actorId` is null for a read-only visitor,
// who is never shown anyone's moves.
export async function getBoard(db: Queryable, workspaceId: string, projectId: string, actorId: string | null): Promise<Board> {
  const spec = (
    await db.query(
      `select s.id, s.name, p.id as project_id, p.name as project_name from delivery.specs s join core.projects p on p.id = s.project_id
       where s.project_id = $1 and s.workspace_id = $2 and s.status = 'published' order by s.published_at desc limit 1`,
      [projectId, workspaceId],
    )
  ).rows[0]
  if (!spec) throw new NoBoard()
  const rows = (await db.query(`${STORY_SQL} where s.spec_id = $1 order by s.position, s.key`, [spec.id])).rows
  const stories = rows.map(toStory)
  const themes = new Map<string, { id: string; title: string; count: number }>()
  for (const s of stories) {
    if (!s.theme) continue
    const t = themes.get(s.theme.id) ?? { id: s.theme.id, title: s.theme.title, count: 0 }
    t.count++
    themes.set(s.theme.id, t)
  }
  return { specId: spec.id, specName: spec.name, projectId: spec.project_id, projectName: spec.project_name, stories, themes: [...themes.values()].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title)), lastMove: actorId ? await lastMove(db, actorId, spec.id) : null }
}

async function lastMove(db: Queryable, actorId: string, specId: string): Promise<LastMove | null> {
  const r = (
    await db.query(
      `select a.entity_id, a.before, a.after, s.key, s.title from core.audit_log a join delivery.stories s on s.id = a.entity_id
       where a.verb = 'moved' and a.undone_at is null and a.actor_id = $1 and s.spec_id = $2 order by a.created_at desc limit 1`,
      [actorId, specId],
    )
  ).rows[0]
  return r ? { storyId: r.entity_id, key: r.key, title: r.title, from: r.before.status, to: r.after.status } : null
}

export async function getStory(db: Queryable, workspaceId: string, storyId: string): Promise<StoryDetail | undefined> {
  const r = (await db.query(`${STORY_SQL} where s.id = $1 and s.workspace_id = $2`, [storyId, workspaceId])).rows[0]
  if (!r) return undefined
  const checklist = (await db.query(`select id, kind, text, met, position from delivery.story_checklist where story_id = $1 order by position`, [storyId])).rows
  return { ...toStory(r), specId: r.spec_id, checklist: checklist.map((c) => ({ id: c.id, kind: c.kind, text: c.text, met: c.met, position: c.position })) }
}

// Locks the story and checks the version the person was looking at.
async function lockStory(tx: Queryable, ctx: Actor, storyId: string, expected: number) {
  const s = (await tx.query(`select id, spec_id, status, position::float8 as position, version from delivery.stories where id = $1 and workspace_id = $2 for update`, [storyId, ctx.workspaceId])).rows[0]
  if (!s) throw new StoryNotFound()
  if (s.version !== expected) throw new StoryVersionConflict(s.version)
  return s as { id: string; spec_id: string; status: StoryStatus; position: number; version: number }
}

const audit = (tx: Queryable, ctx: Actor, storyId: string, verb: string, before: unknown, after: unknown) =>
  insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'delivery.stories', entity_id: storyId, verb, before, after }])

// Moves a card to a column, just before another card there (or last). One row changes; if the neighbours are too close
// to fit it, the column is renumbered first. Dropping a card where it already is changes nothing.
export async function moveStory(db: Db, ctx: Actor, storyId: string, expected: number, to: { status: StoryStatus; beforeId: string | null }): Promise<void> {
  await db.transaction(async (tx) => {
    const story = await lockStory(tx, ctx, storyId, expected)
    const all = (await tx.query(`select id, status, position::float8 as position from delivery.stories where spec_id = $1`, [story.spec_id])).rows as { id: string; status: StoryStatus; position: number }[]
    if (to.beforeId) {
      const target = all.find((s) => s.id === to.beforeId)
      if (!target || target.status !== to.status) throw new ApiError(422, 'validation_failed', 'That card is not in the column you are dropping into.', 'beforeId')
    }
    let list = all
    let { position, renumber: needs } = positionFor(list, storyId, to.status, to.beforeId)
    if (needs) {
      const fresh = renumber(list, storyId, to.status)
      for (const r of fresh) await tx.query(`update delivery.stories set position = $2 where id = $1`, [r.id, r.position])
      const byId = new Map(fresh.map((r) => [r.id, r.position]))
      list = list.map((s) => (byId.has(s.id) ? { ...s, position: byId.get(s.id)! } : s))
      position = positionFor(list, storyId, to.status, to.beforeId).position
    }
    const order = (l: typeof all, status: string) => l.filter((s) => s.status === status).sort((a, b) => a.position - b.position).map((s) => s.id).join(',')
    const after = list.map((s) => (s.id === storyId ? { ...s, status: to.status, position } : s))
    if (story.status === to.status && order(list, to.status) === order(after, to.status)) return // dropped where it already is
    await tx.query(`update delivery.stories set status = $2, position = $3, updated_by = $4 where id = $1`, [storyId, to.status, position, ctx.userId])
    await audit(tx, ctx, storyId, 'moved', { status: story.status, position: story.position }, { status: to.status, position })
  })
}

// Reverses the last move this person made on the board, if the card has not been moved again since.
export async function undoMove(db: Db, ctx: Actor, specId: string): Promise<string> {
  return db.transaction(async (tx) => {
    const a = (
      await tx.query(
        `select a.id, a.entity_id, a.before, a.after from core.audit_log a join delivery.stories s on s.id = a.entity_id
         where a.verb = 'moved' and a.undone_at is null and a.actor_id = $1 and s.spec_id = $2 and a.workspace_id = $3 order by a.created_at desc limit 1 for update of a`,
        [ctx.userId, specId, ctx.workspaceId],
      )
    ).rows[0]
    if (!a) throw new NothingToUndo()
    const s = (await tx.query(`select id, status, position::float8 as position from delivery.stories where id = $1 for update`, [a.entity_id])).rows[0]
    if (!s || s.status !== a.after.status || Number(s.position) !== Number(a.after.position)) throw new CannotUndo()
    await tx.query(`update delivery.stories set status = $2, position = $3, updated_by = $4 where id = $1`, [a.entity_id, a.before.status, a.before.position, ctx.userId])
    await tx.query(`update core.audit_log set undone_at = now() where id = $1`, [a.id])
    return a.entity_id as string
  })
}

export async function patchStory(db: Db, ctx: Actor, storyId: string, expected: number, patch: { ownerTeam?: string | null; priority?: 'low' | 'medium' | 'high' }): Promise<void> {
  await db.transaction(async (tx) => {
    const story = await lockStory(tx, ctx, storyId, expected)
    const before = (await tx.query(`select owner_team, priority from delivery.stories where id = $1`, [storyId])).rows[0]
    await tx.query(`update delivery.stories set owner_team = $2, priority = $3, updated_by = $4 where id = $1`, [
      storyId, patch.ownerTeam !== undefined ? patch.ownerTeam : before.owner_team, patch.priority ?? before.priority, ctx.userId,
    ])
    await audit(tx, ctx, story.id, 'story_edited', { ownerTeam: before.owner_team, priority: before.priority }, patch)
  })
}

export class UnknownChecklistItem extends Error {}

// The checklist is saved as a whole. An item with an id is updated in place; one without is added; one left out is removed.
export async function saveChecklist(db: Db, ctx: Actor, storyId: string, expected: number, items: { id: string | null; kind: 'criterion' | 'task'; text: string; met: boolean }[]): Promise<void> {
  await db.transaction(async (tx) => {
    await lockStory(tx, ctx, storyId, expected)
    const existing = new Set((await tx.query(`select id from delivery.story_checklist where story_id = $1`, [storyId])).rows.map((r) => r.id as string))
    const keep = new Set<string>()
    for (const [position, it] of items.entries()) {
      if (it.id) {
        if (!existing.has(it.id)) throw new UnknownChecklistItem(it.id)
        keep.add(it.id)
        await tx.query(`update delivery.story_checklist set kind = $2, text = $3, met = $4, position = $5, updated_by = $6 where id = $1`, [it.id, it.kind, it.text, it.met, position, ctx.userId])
      } else {
        await tx.query(`insert into delivery.story_checklist (workspace_id, story_id, kind, text, met, position, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $7)`, [ctx.workspaceId, storyId, it.kind, it.text, it.met, position, ctx.userId])
      }
    }
    const remove = [...existing].filter((id) => !keep.has(id))
    if (remove.length) await tx.query(`delete from delivery.story_checklist where id = any($1::uuid[])`, [remove])
    await tx.query(`update delivery.stories set updated_by = $2 where id = $1`, [storyId, ctx.userId]) // bumps the story's version
    await audit(tx, ctx, storyId, 'checklist_saved', null, { items: items.length, met: items.filter((i) => i.met).length })
  })
}
