// Keeping Platform Themes clean: rename, merge (by a person, or by the system when a pair is clear, always recorded and undoable), suggested
// merges for the pairs that are not clear, and the written reason for each theme's rank. The model only proposes and explains; what it
// may do on its own is limited to autoMergeAllowed.
import { callAiWithFallback, type Ai } from './ai.js'
import { similarThemes, type DedupeInput } from './ai-dedupe.js'
import { templateRationale, type RankedTheme, type Rationale } from './ai-rationale.js'
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { assertAreasUsable } from './areas.js'
import { getThemesOverview, platformAreas } from './insights.js'

export class PlatformThemeMissing extends Error {}
export class DuplicateTitle extends Error {
  constructor(public existing: string) {
    super(`"${existing}" already exists.`)
  }
}
export class SameTheme extends Error {}
export class MergeHistoryMissing extends Error {}
/** The theme already has a feature area; the table only fills in the ones with none. */
export class AlreadyAssigned extends Error {}
/** There is no area a person filed this theme under, so there is nothing to take back. */
export class NotFiledByHand extends Error {}

const FREE = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
// The matcher takes this lock too, so a merge, a rename and a match never interleave.
const lock = (tx: Queryable, workspaceId: string) => tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`platform-match:${workspaceId}`])
const audit = (tx: Queryable, ctx: RequestContext, verb: string, id: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'insights.platform_themes', $3, $4, $5, $6)`, [
    ctx.workspaceId, ctx.userId, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

/** Renames a platform theme. The old name stays as an alias, so the matcher still recognises it. Renaming counts as reviewing. */
export async function renameTheme(db: Db, ctx: RequestContext, id: string, rawTitle: string): Promise<{ id: string; title: string }> {
  const title = clean(rawTitle)
  return db.transaction(async (tx) => {
    await lock(tx, ctx.workspaceId)
    const mine = (await tx.query(`select id, title from insights.platform_themes where id = $1 and workspace_id = $2 for update`, [id, ctx.workspaceId])).rows[0]
    if (!mine) throw new PlatformThemeMissing()
    const others = (await tx.query(`select t.id, t.title from insights.platform_themes t where t.workspace_id = $1 and t.id <> $2 union all select a.platform_theme_id, a.alias from insights.platform_theme_aliases a where a.workspace_id = $1 and a.platform_theme_id <> $2`, [ctx.workspaceId, id])).rows
    const clash = others.find((o) => same(o.title, title))
    if (clash) throw new DuplicateTitle(clash.title)
    if (title !== mine.title) {
      await tx.query(`update insights.platform_themes set title = $1, needs_review = false where id = $2`, [title, id])
      await tx.query(`delete from insights.platform_theme_aliases where platform_theme_id = $1 and lower(alias) = lower($2)`, [id, title])
      if (!same(mine.title, title)) await tx.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) values ($1, $2, $3) on conflict do nothing`, [id, ctx.workspaceId, mine.title])
      await audit(tx, ctx, 'renamed', id, { title: mine.title }, { title })
    } else await tx.query(`update insights.platform_themes set needs_review = false where id = $1`, [id])
    return { id, title }
  })
}

export type MergeOptions = { /** True when the system merged them, not a person. */ auto?: boolean; confidence?: number | null; reason?: string | null }

/**
 * Folds `fromId` into `intoId`: its tags, recommendations and case studies move across, its name becomes an alias, and it is deleted.
 * What is needed to take it back is written to insights.merge_history in the same transaction (see undoMerge).
 */
export async function mergeThemes(db: Db, ctx: RequestContext, fromId: string, intoId: string, opts: MergeOptions = {}): Promise<{ id: string; title: string; historyId: string }> {
  if (fromId === intoId) throw new SameTheme()
  return db.transaction(async (tx) => {
    await lock(tx, ctx.workspaceId)
    const rows = (await tx.query(`select id, title, category, needs_review, position, rationale, rationale_at from insights.platform_themes where workspace_id = $1 and id = any($2::uuid[]) for update`, [ctx.workspaceId, [fromId, intoId]])).rows
    const from = rows.find((r) => r.id === fromId)
    const into = rows.find((r) => r.id === intoId)
    if (!from || !into) throw new PlatformThemeMissing()
    const w = ctx.workspaceId
    const col = async (sql: string, ...params: unknown[]) => (await tx.query(sql, params)).rows.map((r) => Object.values(r)[0] as string)

    // What is there before, so an undo can put back exactly what the merge changed.
    const fromAliases = await col(`select alias from insights.platform_theme_aliases where platform_theme_id = $1 order by alias`, fromId)
    const intoAliases = new Set((await col(`select alias from insights.platform_theme_aliases where platform_theme_id = $1`, intoId)).map((a) => a.toLowerCase()))
    const sources = (await tx.query(`select theme_id, match_method, confidence, reason from insights.platform_theme_sources where platform_theme_id = $1`, [fromId])).rows
    const fromRecs = await col(`select recommendation_id from insights.recommendation_themes where platform_theme_id = $1`, fromId)
    const intoRecs = new Set(await col(`select recommendation_id from insights.recommendation_themes where platform_theme_id = $1`, intoId))
    const fromCases = await col(`select case_study_id from insights.case_study_themes where platform_theme_id = $1`, fromId)
    const intoCases = new Set(await col(`select case_study_id from insights.case_study_themes where platform_theme_id = $1`, intoId))
    const wanted = [...fromAliases, ...(!same(from.title, into.title) ? [from.title as string] : [])]
    const addedAliases = [...new Map(wanted.filter((a) => !intoAliases.has(a.toLowerCase()) && !same(a, into.title)).map((a) => [a.toLowerCase(), a])).values()]

    await tx.query(`update insights.platform_theme_sources set platform_theme_id = $1 where platform_theme_id = $2 and workspace_id = $3`, [intoId, fromId, w])
    await tx.query(`insert into insights.recommendation_themes (recommendation_id, platform_theme_id, workspace_id) select recommendation_id, $1, workspace_id from insights.recommendation_themes where platform_theme_id = $2 on conflict do nothing`, [intoId, fromId])
    await tx.query(`insert into insights.case_study_themes (case_study_id, platform_theme_id, workspace_id) select case_study_id, $1, workspace_id from insights.case_study_themes where platform_theme_id = $2 on conflict do nothing`, [intoId, fromId])
    for (const alias of addedAliases) await tx.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) values ($1, $2, $3) on conflict do nothing`, [intoId, w, alias])
    await tx.query(`update insights.platform_themes set needs_review = false, rationale = null, rationale_at = null where id = $1`, [intoId])
    await tx.query(`delete from insights.platform_themes where id = $1`, [fromId]) // the rest of its rows follow by cascade
    const history = (
      await tx.query(
        `insert into insights.merge_history (workspace_id, kept_id, merged_id, merged, moved, confidence, reason, auto, created_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
        [
          w, intoId, fromId,
          JSON.stringify({ title: from.title, category: from.category, needsReview: from.needs_review, position: from.position, rationale: from.rationale, rationaleAt: from.rationale_at, aliases: fromAliases }),
          JSON.stringify({
            sources: sources.map((r) => ({ themeId: r.theme_id, method: r.match_method, confidence: r.confidence === null ? null : Number(r.confidence), reason: r.reason })),
            recommendations: fromRecs, addedRecommendations: fromRecs.filter((x) => !intoRecs.has(x)), caseStudies: fromCases, addedCaseStudies: fromCases.filter((x) => !intoCases.has(x)), addedAliases,
            keptTitle: into.title,
          }),
          opts.confidence === undefined || opts.confidence === null ? null : Number(opts.confidence.toFixed(2)), opts.reason ?? null, !!opts.auto, opts.auto ? null : ctx.userId,
        ],
      )
    ).rows[0]
    await audit(tx, ctx, opts.auto ? 'merged automatically' : 'merged', intoId, { merged: { id: fromId, title: from.title } }, { title: into.title })
    return { id: intoId, title: into.title as string, historyId: history.id as string }
  })
}

export type MergeRecord = { id: string; keptId: string; keptTitle: string; mergedTitle: string; auto: boolean; confidence: number | null; reason: string | null; createdAt: string; undone: boolean; canUndo: boolean }

/** The most recent merges, newest first. `canUndo` is false once the theme it was folded into is gone or the merge was already undone. */
export async function listMerges(db: Queryable, workspaceId: string, limit = 20): Promise<MergeRecord[]> {
  const rows = (
    await db.query(
      `select h.id, h.kept_id, h.merged, h.moved, h.confidence, h.reason, h.auto, h.created_at, h.undone_at, p.title as kept_title
         from insights.merge_history h left join insights.platform_themes p on p.id = h.kept_id
        where h.workspace_id = $1 order by h.created_at desc limit $2`,
      [workspaceId, limit],
    )
  ).rows
  return rows.map((r) => ({
    id: r.id, keptId: r.kept_id, keptTitle: r.kept_title ?? r.moved?.keptTitle ?? '', mergedTitle: r.merged?.title ?? '', auto: !!r.auto,
    confidence: r.confidence === null ? null : Number(r.confidence), reason: r.reason ?? null, createdAt: new Date(r.created_at).toISOString(), undone: !!r.undone_at, canUndo: !r.undone_at && !!r.kept_title,
  }))
}

/**
 * Takes a merge back: the theme that was folded in is recreated under its old id, with its own names, and the project themes,
 * recommendation links and case-study links the merge moved (and only those) go back to it. A project theme that was re-analysed in the meantime
 * is simply gone and stays gone. Refused if the theme it was folded into no longer exists, or if the old title now belongs to another theme.
 */
export async function undoMerge(db: Db, ctx: RequestContext, historyId: string): Promise<{ id: string; title: string }> {
  return db.transaction(async (tx) => {
    await lock(tx, ctx.workspaceId)
    const h = (await tx.query(`select * from insights.merge_history where id = $1 and workspace_id = $2 and undone_at is null for update`, [historyId, ctx.workspaceId])).rows[0]
    if (!h) throw new MergeHistoryMissing()
    const kept = (await tx.query(`select id from insights.platform_themes where id = $1 and workspace_id = $2 for update`, [h.kept_id, ctx.workspaceId])).rows[0]
    if (!kept) throw new MergeHistoryMissing()
    const w = ctx.workspaceId
    const merged = h.merged as { title: string; category: string; needsReview: boolean; position: number; rationale: string | null; rationaleAt: string | null; aliases: string[] }
    const moved = h.moved as { sources: { themeId: string }[]; recommendations: string[]; addedRecommendations: string[]; caseStudies: string[]; addedCaseStudies: string[]; addedAliases: string[] }

    // The names the merge gave the theme it was folded into go back first, so the old title is free to use again.
    if (moved.addedAliases.length) await tx.query(`delete from insights.platform_theme_aliases where platform_theme_id = $1 and alias = any($2::text[])`, [h.kept_id, moved.addedAliases])
    const taken = (await tx.query(`select t.title from insights.platform_themes t where t.workspace_id = $1 union all select a.alias from insights.platform_theme_aliases a where a.workspace_id = $1`, [w])).rows
    const clash = taken.find((r) => same(String(r.title), merged.title))
    if (clash) throw new DuplicateTitle(String(clash.title))

    await tx.query(
      `insert into insights.platform_themes (id, workspace_id, title, category, needs_review, position, rationale, rationale_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [h.merged_id, w, merged.title, merged.category, merged.needsReview, merged.position, merged.rationale, merged.rationaleAt],
    )
    for (const alias of merged.aliases) await tx.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) values ($1, $2, $3) on conflict do nothing`, [h.merged_id, w, alias])
    const themeIds = moved.sources.map((x) => x.themeId)
    if (themeIds.length) await tx.query(`update insights.platform_theme_sources set platform_theme_id = $1 where platform_theme_id = $2 and workspace_id = $3 and theme_id = any($4::uuid[])`, [h.merged_id, h.kept_id, w, themeIds])
    if (moved.recommendations.length) await tx.query(`insert into insights.recommendation_themes (recommendation_id, platform_theme_id, workspace_id) select r.id, $1, $2 from insights.recommendations r where r.id = any($3::uuid[]) on conflict do nothing`, [h.merged_id, w, moved.recommendations])
    if (moved.addedRecommendations.length) await tx.query(`delete from insights.recommendation_themes where platform_theme_id = $1 and recommendation_id = any($2::uuid[])`, [h.kept_id, moved.addedRecommendations])
    if (moved.caseStudies.length) await tx.query(`insert into insights.case_study_themes (case_study_id, platform_theme_id, workspace_id) select c.id, $1, $2 from insights.case_studies c where c.id = any($3::uuid[]) on conflict do nothing`, [h.merged_id, w, moved.caseStudies])
    if (moved.addedCaseStudies.length) await tx.query(`delete from insights.case_study_themes where platform_theme_id = $1 and case_study_id = any($2::uuid[])`, [h.kept_id, moved.addedCaseStudies])
    await tx.query(`update insights.platform_themes set rationale = null, rationale_at = null where id = $1`, [h.kept_id]) // its figures changed again
    await tx.query(`update insights.merge_history set undone_at = now(), undone_by = $2 where id = $1`, [historyId, ctx.userId])
    await audit(tx, ctx, 'merge undone', h.kept_id, { merged: { id: h.merged_id, title: merged.title } }, { restored: merged.title })
    return { id: h.merged_id as string, title: merged.title }
  })
}

// Automatic merging ---------------------------------------------------------------------------------------------------------------

/** The model's (or the word check's) confidence a pair must reach to be merged without asking: lower when both are in the same known feature area, which is extra evidence. */
export const AUTO_MERGE_SAME_AREA = 0.75
export const AUTO_MERGE_OTHER = 0.9

/** Whether a pair is merged on its own: it must be the same kind of theme (a pain point is never folded into a delight) and clear the bar for its areas. */
export function autoMergeAllowed(keep: { category: string; area?: string | null }, merge: { category: string; area?: string | null }, confidence: number): boolean {
  if (keep.category !== merge.category) return false
  const sameKnownArea = !!keep.area && !!merge.area && keep.area.toLowerCase() === merge.area.toLowerCase()
  return confidence >= (sameKnownArea ? AUTO_MERGE_SAME_AREA : AUTO_MERGE_OTHER)
}

type Proposal = { input: DedupeInput; groups: Awaited<ReturnType<typeof similarThemes>>; fallback?: 'budget' | 'credit' }

async function proposeGroups(db: Db, ai: Ai, workspaceId: string): Promise<Proposal | null> {
  const overview = await getThemesOverview(db, workspaceId)
  if (overview.themes.length < 2) return null
  const areas = await platformAreas(db, workspaceId)
  const input: DedupeInput = { themes: overview.themes.map((t) => ({ id: t.id, title: t.title, category: t.category, aliases: t.aliases, participants: t.participantCount, projects: t.projectCount, area: areas.get(t.id) ?? null })) }
  const { value: groups, fallback } = await callAiWithFallback(db, ai, workspaceId, 'theme_match', async (p) => {
    if (p.suggestMerges) {
      const r = await p.suggestMerges(input)
      return { value: r.value.groups, usage: r.usage }
    }
    return { value: similarThemes(input), usage: FREE }
  })
  return { input, groups, ...(fallback ? { fallback } : {}) }
}

/**
 * Looks for platform themes that say the same thing and folds the clear ones together without asking, each one recorded so it can be
 * undone. A pair that clears the bar (autoMergeAllowed) is merged; the rest are filed as suggestions, which nothing shows yet.
 * Nothing here changes the numbers people rely on: the merged theme's participants are the union of both, and undo restores the split.
 */
export async function autoMergeDuplicates(db: Db, ai: Ai, ctx: RequestContext): Promise<{ merged: number; suggested: number; fallback?: 'budget' | 'credit' }> {
  const proposal = await proposeGroups(db, ai, ctx.workspaceId)
  if (!proposal) return { merged: 0, suggested: 0 }
  const byId = new Map(proposal.input.themes.map((t) => [t.id, t]))
  let merged = 0
  const rest: typeof proposal.groups = []
  for (const g of proposal.groups) {
    const keep = byId.get(g.keepId)
    const left: string[] = []
    for (const mergeId of g.mergeIds) {
      const other = byId.get(mergeId)
      if (!keep || !other || !autoMergeAllowed(keep, other, g.confidence)) {
        left.push(mergeId)
        continue
      }
      try {
        await mergeThemes(db, ctx, mergeId, g.keepId, { auto: true, confidence: g.confidence, reason: g.reason || null })
        merged++
      } catch (err) {
        if (!(err instanceof PlatformThemeMissing) && !(err instanceof SameTheme)) throw err
      }
    }
    if (left.length) rest.push({ ...g, mergeIds: left })
  }
  const suggested = await fileSuggestions(db, ctx.workspaceId, rest)
  return { merged, suggested, ...(proposal.fallback ? { fallback: proposal.fallback } : {}) }
}

// Suggested merges ------------------------------------------------------------------------------------------------------------

async function fileSuggestions(db: Db, workspaceId: string, groups: Awaited<ReturnType<typeof similarThemes>>): Promise<number> {
  let added = 0
  await db.transaction(async (tx) => {
    for (const g of groups) {
      for (const mergeId of g.mergeIds) {
        const res = await tx.query(
          `insert into insights.merge_suggestions (workspace_id, keep_id, merge_id, reason, confidence)
           select $1, $2, $3, $4, $5
           where exists (select 1 from insights.platform_themes where id = $2 and workspace_id = $1) and exists (select 1 from insights.platform_themes where id = $3 and workspace_id = $1)
             and not exists (select 1 from insights.merge_suggestions where (keep_id = $2 and merge_id = $3) or (keep_id = $3 and merge_id = $2))
           returning id`,
          [workspaceId, g.keepId, mergeId, g.reason || null, Number(g.confidence.toFixed(2))],
        )
        added += res.rows.length
      }
    }
  })
  return added
}

/** Compares every platform theme and files the pairs that look alike as suggestions. Nothing is merged here (see autoMergeDuplicates). */
export async function findMergeSuggestions(db: Db, ai: Ai, workspaceId: string): Promise<{ added: number; fallback?: 'budget' | 'credit' }> {
  const proposal = await proposeGroups(db, ai, workspaceId)
  if (!proposal) return { added: 0 }
  return { added: await fileSuggestions(db, workspaceId, proposal.groups), ...(proposal.fallback ? { fallback: proposal.fallback } : {}) }
}

export async function acceptSuggestion(db: Db, ctx: RequestContext, id: string): Promise<{ id: string; title: string }> {
  const s = (await db.query(`select keep_id, merge_id from insights.merge_suggestions where id = $1 and workspace_id = $2 and status = 'pending'`, [id, ctx.workspaceId])).rows[0]
  if (!s) throw new PlatformThemeMissing()
  const r = await mergeThemes(db, ctx, s.merge_id, s.keep_id)
  return { id: r.id, title: r.title }
}

export async function dismissSuggestion(db: Queryable, workspaceId: string, id: string): Promise<boolean> {
  const r = await db.query(`update insights.merge_suggestions set status = 'dismissed' where id = $1 and workspace_id = $2 and status = 'pending' returning id`, [id, workspaceId])
  return r.rows.length > 0
}

// Rationale for the ranking --------------------------------------------------------------------------------------------------------

export const RATIONALE_TOP = 8

/** Writes why the top-ranked themes rank where they do and saves it on each theme. */
export async function writeRankRationales(db: Db, ai: Ai, workspaceId: string): Promise<{ written: number; fallback?: 'budget' | 'credit' }> {
  const overview = await getThemesOverview(db, workspaceId)
  const totalProjects = overview.projects.length
  const top: RankedTheme[] = overview.themes
    .filter((t) => t.priority && t.priority.rank <= RATIONALE_TOP)
    .sort((a, b) => a.priority!.rank - b.priority!.rank)
    .map((t) => ({
      id: t.id, title: t.title, rank: t.priority!.rank, participants: t.participantCount, totalParticipants: overview.totalParticipants, projects: t.projectCount, totalProjects,
      status: t.status, trend: t.trend, opportunity: t.opportunity, summary: t.summary, requirements: t.requirements.map((r) => r.title),
    }))
  if (!top.length) return { written: 0 }
  const { value, fallback } = await callAiWithFallback(db, ai, workspaceId, 'theme_match', async (p): Promise<{ value: Rationale[]; usage: typeof FREE }> => {
    if (p.writeRationales) {
      const r = await p.writeRationales({ themes: top })
      return { value: r.value.rationales, usage: r.usage }
    }
    return { value: top.map((t) => ({ themeId: t.id, text: templateRationale(t) })), usage: FREE }
  })
  await db.transaction(async (tx) => {
    for (const r of value) await tx.query(`update insights.platform_themes set rationale = $1, rationale_at = now() where id = $2 and workspace_id = $3`, [r.text, r.themeId, workspaceId])
  })
  return { written: value.length, ...(fallback ? { fallback } : {}) }
}

/**
 * Files a platform theme that has no feature area under one (editors). It sets the area on the project themes behind it that have none;
 * a theme that already has an area is left as it is (AlreadyAssigned), because areas are meant to come from the analysis, not be rearranged by hand.
 */
export async function assignThemeArea(db: Db, ctx: RequestContext, platformThemeId: string, areaId: string): Promise<{ filed: number }> {
  return db.transaction(async (tx) => {
    const found = (await tx.query(`select id from insights.platform_themes where id = $1 and workspace_id = $2 for update`, [platformThemeId, ctx.workspaceId])).rows[0]
    if (!found) throw new PlatformThemeMissing()
    await assertAreasUsable(tx, ctx.workspaceId, [areaId])
    if ((await platformAreas(tx, ctx.workspaceId)).has(platformThemeId)) throw new AlreadyAssigned()
    const done = await tx.query(
      `update research.themes set area_id = $2, updated_by = $3 where area_id is null and id in (select theme_id from insights.platform_theme_sources where platform_theme_id = $1) returning id`,
      [platformThemeId, areaId, ctx.userId],
    )
    await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'insights.platform_themes', $3, 'area set', null, $4)`, [ctx.workspaceId, ctx.userId, platformThemeId, JSON.stringify({ areaId, themes: done.rows.length })])
    return { filed: done.rows.length }
  })
}

/**
 * Takes back a person's filing of a theme under a feature area (editors): the project themes behind it that carry that area go back to
 * none, and the theme is Unassigned again. Only a filing a person made can be taken back (NotFiledByHand); an area the analysis chose is not undone here.
 */
export async function clearThemeArea(db: Db, ctx: RequestContext, platformThemeId: string): Promise<{ cleared: number }> {
  return db.transaction(async (tx) => {
    const found = (await tx.query(`select id from insights.platform_themes where id = $1 and workspace_id = $2 for update`, [platformThemeId, ctx.workspaceId])).rows[0]
    if (!found) throw new PlatformThemeMissing()
    const last = (
      await tx.query(
        `select verb, after->>'areaId' as area_id from core.audit_log where workspace_id = $1 and entity = 'insights.platform_themes' and entity_id = $2 and verb in ('area set', 'area cleared') order by created_at desc, id desc limit 1`,
        [ctx.workspaceId, platformThemeId],
      )
    ).rows[0]
    if (!last || last.verb !== 'area set' || !last.area_id) throw new NotFiledByHand()
    const done = await tx.query(
      `update research.themes set area_id = null, updated_by = $3 where area_id = $2 and id in (select theme_id from insights.platform_theme_sources where platform_theme_id = $1) returning id`,
      [platformThemeId, last.area_id, ctx.userId],
    )
    await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'insights.platform_themes', $3, 'area cleared', $4, null)`, [ctx.workspaceId, ctx.userId, platformThemeId, JSON.stringify({ areaId: last.area_id, themes: done.rows.length })])
    return { cleared: done.rows.length }
  })
}
