// Keeping Platform Themes clean: rename, merge, suggested merges, and the written reason for each theme's rank. Every change here is a
// person's action (or a suggestion waiting for one); the model only proposes and explains.
import { callAiWithFallback, type Ai } from './ai.js'
import { similarThemes, type DedupeInput } from './ai-dedupe.js'
import { templateRationale, type RankedTheme, type Rationale } from './ai-rationale.js'
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { getThemesOverview } from './insights.js'

export class PlatformThemeMissing extends Error {}
export class DuplicateTitle extends Error {
  constructor(public existing: string) {
    super(`"${existing}" already exists.`)
  }
}
export class SameTheme extends Error {}

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

/** Folds `fromId` into `intoId`: its tags, recommendations and case studies move across, its name becomes an alias, and it is deleted. */
export async function mergeThemes(db: Db, ctx: RequestContext, fromId: string, intoId: string): Promise<{ id: string; title: string }> {
  if (fromId === intoId) throw new SameTheme()
  return db.transaction(async (tx) => {
    await lock(tx, ctx.workspaceId)
    const rows = (await tx.query(`select id, title from insights.platform_themes where workspace_id = $1 and id = any($2::uuid[]) for update`, [ctx.workspaceId, [fromId, intoId]])).rows
    const from = rows.find((r) => r.id === fromId)
    const into = rows.find((r) => r.id === intoId)
    if (!from || !into) throw new PlatformThemeMissing()
    const w = ctx.workspaceId
    await tx.query(`update insights.platform_theme_sources set platform_theme_id = $1 where platform_theme_id = $2 and workspace_id = $3`, [intoId, fromId, w])
    await tx.query(`insert into insights.recommendation_themes (recommendation_id, platform_theme_id, workspace_id) select recommendation_id, $1, workspace_id from insights.recommendation_themes where platform_theme_id = $2 on conflict do nothing`, [intoId, fromId])
    await tx.query(`insert into insights.case_study_themes (case_study_id, platform_theme_id, workspace_id) select case_study_id, $1, workspace_id from insights.case_study_themes where platform_theme_id = $2 on conflict do nothing`, [intoId, fromId])
    await tx.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) select $1, workspace_id, alias from insights.platform_theme_aliases where platform_theme_id = $2 on conflict do nothing`, [intoId, fromId])
    if (!same(from.title, into.title)) await tx.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) values ($1, $2, $3) on conflict do nothing`, [intoId, w, from.title])
    await tx.query(`update insights.platform_themes set needs_review = false, rationale = null, rationale_at = null where id = $1`, [intoId])
    await tx.query(`delete from insights.platform_themes where id = $1`, [fromId]) // the rest of its rows follow by cascade
    await audit(tx, ctx, 'merged', intoId, { merged: { id: fromId, title: from.title } }, { title: into.title })
    return { id: intoId, title: into.title }
  })
}

// Suggested merges ------------------------------------------------------------------------------------------------------------

/** Compares every platform theme and files the pairs that look alike for a person to accept or dismiss. Nothing is merged here. */
export async function findMergeSuggestions(db: Db, ai: Ai, workspaceId: string): Promise<{ added: number; fallback?: 'budget' | 'credit' }> {
  const overview = await getThemesOverview(db, workspaceId)
  if (overview.themes.length < 2) return { added: 0 }
  const input: DedupeInput = { themes: overview.themes.map((t) => ({ id: t.id, title: t.title, category: t.category, aliases: t.aliases, participants: t.participantCount, projects: t.projectCount })) }
  const { value: groups, fallback } = await callAiWithFallback(db, ai, workspaceId, 'theme_match', async (p) => {
    if (p.suggestMerges) {
      const r = await p.suggestMerges(input)
      return { value: r.value.groups, usage: r.usage }
    }
    return { value: similarThemes(input), usage: FREE }
  })
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
  return { added, ...(fallback ? { fallback } : {}) }
}

export async function acceptSuggestion(db: Db, ctx: RequestContext, id: string): Promise<{ id: string; title: string }> {
  const s = (await db.query(`select keep_id, merge_id from insights.merge_suggestions where id = $1 and workspace_id = $2 and status = 'pending'`, [id, ctx.workspaceId])).rows[0]
  if (!s) throw new PlatformThemeMissing()
  return mergeThemes(db, ctx, s.merge_id, s.keep_id)
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
