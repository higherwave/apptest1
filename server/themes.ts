import type { Db, Queryable } from './db.js'
import { ApiError } from './errors.js'
import { currentAnalysisRun } from './transcripts.js'
import { insertMany } from './sql.js'
import type { Actor } from './versioning.js'
import type { ThemePatchInput } from './schemas.js'

export type Quote = { id: string; speaker: string; participant: string | null; session: string; timestamp: string | null; text: string }
export type Theme = {
  id: string
  title: string
  originalTitle: string
  category: 'pain_point' | 'need' | 'expectation' | 'delight'
  stagePosition: number | null
  suggestedStagePosition: number | null
  severity: number | null
  description: string | null
  opportunity: string | null
  priority: 'low' | 'medium' | 'high'
  suggestedPriority: 'low' | 'medium' | 'high'
  effort: number
  suggestedEffort: number
  effortNote: string | null
  /** True when the person changed the priority or effort from what the analysis suggested. */
  edited: boolean
  /** The version of the person's edits to this theme (0 when there are none); sent back as If-Match. */
  overrideVersion: number
  participantCount: number
  totalParticipants: number
  mentionCount: number
  score: number | null
  quotes?: Quote[]
}

export class ThemeNotFound extends Error {}
export class ThemeConflict extends Error {
  constructor(public current: number) {
    super('theme version conflict')
  }
}
export class ThemeSuperseded extends Error {}

const THEME_SQL = `
  select t.id, t.project_id, t.title as original_title, t.category, t.stage_position, t.severity, t.description, t.opportunity,
         t.suggested_priority, t.suggested_effort, t.effort_note, t.score,
         o.title as o_title, o.stage_position as o_stage, o.priority as o_priority, o.effort as o_effort,
         coalesce(o.version, 0) as override_version,
         st.participant_count::int as participant_count, st.total_participants::int as total_participants, st.mention_count::int as mention_count
  from research.themes t
  left join research.theme_overrides o on o.theme_id = t.id
  join research.theme_stats st on st.theme_id = t.id`

function toTheme(r: Record<string, any>): Theme {
  const priority = r.o_priority ?? r.suggested_priority
  const effort = r.o_effort ?? r.suggested_effort
  return {
    id: r.id,
    title: r.o_title ?? r.original_title,
    originalTitle: r.original_title,
    category: r.category,
    stagePosition: r.o_stage ?? r.stage_position ?? null,
    suggestedStagePosition: r.stage_position ?? null,
    severity: r.severity === null ? null : Number(r.severity),
    description: r.description ?? null,
    opportunity: r.opportunity ?? null,
    priority,
    suggestedPriority: r.suggested_priority,
    effort,
    suggestedEffort: r.suggested_effort,
    effortNote: r.effort_note ?? null,
    edited: priority !== r.suggested_priority || effort !== r.suggested_effort,
    overrideVersion: r.override_version,
    participantCount: r.participant_count,
    totalParticipants: r.total_participants,
    mentionCount: r.mention_count,
    score: r.score === null ? null : Number(r.score),
  }
}

async function withQuotes(db: Queryable, themes: Theme[]): Promise<Theme[]> {
  if (!themes.length) return themes
  const rows = (
    await db.query(
      `select tq.theme_id, u.id, sp.name as speaker, pa.name as participant, tr.name as session, u.timestamp_label as ts, u.text
       from research.theme_quotes tq
       join research.utterances u on u.id = tq.utterance_id
       join research.transcript_speakers sp on sp.id = u.speaker_id
       join research.transcripts tr on tr.id = u.transcript_id
       left join research.participants pa on pa.id = sp.participant_id
       where tq.theme_id = any($1::uuid[])
       order by tr.position, u.position`,
      [themes.map((t) => t.id)],
    )
  ).rows
  return themes.map((t) => ({
    ...t,
    quotes: rows.filter((q) => q.theme_id === t.id).map((q) => ({ id: q.id, speaker: q.speaker, participant: q.participant ?? null, session: String(q.session).replace(/\.\w+$/, ''), timestamp: q.ts || null, text: q.text })),
  }))
}

// The current analysis's themes, strongest first. Optional filter by category and optional quotes.
export async function listThemes(db: Queryable, projectId: string, opts: { category?: string; quotes?: boolean } = {}): Promise<Theme[]> {
  const run = await currentAnalysisRun(db, projectId)
  if (!run) return []
  const rows = (
    await db.query(`${THEME_SQL} where t.project_id = $1 and t.run_id = $2 ${opts.category ? 'and t.category = $3' : ''} order by t.score desc nulls last, t.title`, opts.category ? [projectId, run.id, opts.category] : [projectId, run.id])
  ).rows
  const themes = rows.map(toTheme)
  return opts.quotes ? withQuotes(db, themes) : themes
}

export async function getTheme(db: Queryable, workspaceId: string, themeId: string): Promise<(Theme & { projectId: string }) | undefined> {
  const r = (await db.query(`${THEME_SQL} join core.projects p on p.id = t.project_id where t.id = $1 and p.workspace_id = $2`, [themeId, workspaceId])).rows[0]
  return r ? { ...toTheme(r), projectId: r.project_id } : undefined
}

// Applies a partial edit. `null` clears one override (back to what the analysis suggested); a key left out is
// untouched. The edit is checked against the version of this theme's edits (0 when it has none), so two people
// editing different themes never conflict. When nothing is left overridden the row is removed.
export async function patchTheme(db: Db, ctx: Actor, themeId: string, expected: number, patch: ThemePatchInput): Promise<void> {
  await db.transaction(async (tx) => {
    const t = (await tx.query(`select t.id, t.project_id, t.run_id from research.themes t join core.projects p on p.id = t.project_id where t.id = $1 and p.workspace_id = $2`, [themeId, ctx.workspaceId])).rows[0]
    if (!t) throw new ThemeNotFound()
    const run = await currentAnalysisRun(tx, t.project_id)
    if (!run || run.id !== t.run_id) throw new ThemeSuperseded()

    const cur = (await tx.query(`select title, stage_position, priority, effort, version from research.theme_overrides where theme_id = $1 for update`, [themeId])).rows[0]
    if ((cur?.version ?? 0) !== expected) throw new ThemeConflict(cur?.version ?? 0)

    if (patch.stagePosition !== undefined && patch.stagePosition !== null) {
      const stages = (await tx.query(`select count(*)::int n from research.study_stages where study_id = $1`, [t.project_id])).rows[0].n as number
      if (patch.stagePosition >= stages) throw new ApiError(422, 'validation_failed', `Choose a stage from 1 to ${stages}.`, 'stagePosition')
    }
    const next = {
      title: patch.title !== undefined ? patch.title : (cur?.title ?? null),
      stage: patch.stagePosition !== undefined ? patch.stagePosition : (cur?.stage_position ?? null),
      priority: patch.priority !== undefined ? patch.priority : (cur?.priority ?? null),
      effort: patch.effort !== undefined ? patch.effort : (cur?.effort ?? null),
    }
    if (next.title === null && next.stage === null && next.priority === null && next.effort === null) {
      if (cur) await tx.query(`delete from research.theme_overrides where theme_id = $1`, [themeId])
    } else if (cur) {
      await tx.query(`update research.theme_overrides set title = $2, stage_position = $3, priority = $4, effort = $5, updated_by = $6 where theme_id = $1`, [themeId, next.title, next.stage, next.priority, next.effort, ctx.userId])
    } else {
      await tx.query(`insert into research.theme_overrides (theme_id, workspace_id, title, stage_position, priority, effort, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $7)`, [themeId, ctx.workspaceId, next.title, next.stage, next.priority, next.effort, ctx.userId])
    }
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'research.themes', entity_id: themeId, verb: 'theme_edited', before: cur ?? null, after: next }])
  })
}

// "Reset all" in Priorities: clears every importance and effort edit in the current analysis. Names and stage
// placements are separate and stay.
export async function resetPriorityOverrides(db: Db, ctx: Actor, projectId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const run = await currentAnalysisRun(tx, projectId)
    if (!run) return
    await tx.query(`update research.theme_overrides set priority = null, effort = null, updated_by = $3 where theme_id in (select id from research.themes where project_id = $1 and run_id = $2)`, [projectId, run.id, ctx.userId])
    await tx.query(`delete from research.theme_overrides where title is null and stage_position is null and priority is null and effort is null and theme_id in (select id from research.themes where project_id = $1 and run_id = $2)`, [projectId, run.id])
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.projects', entity_id: projectId, verb: 'priorities_reset' }])
  })
}
