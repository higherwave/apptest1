import { PLATFORM_KEYWORDS } from '../shared/platform-keywords.mjs'
import { callAi, callAiWithFallback, type Ai } from './ai.js'
import { matchThemes } from '../shared/providers.mjs'
import { applyAreaRule, MAX_THEMES_PER_CALL, type Placement } from './ai-matching.js'
import type { Db, Queryable } from './db.js'
import { buildCaseStudyPrompt } from './case-briefs.js'
import { insertMany } from './sql.js'

export type Category = 'pain_point' | 'need' | 'expectation' | 'delight'
export type InsightProject = { id: string; name: string; color: string; participants: number }
/** What became of a theme: no requirement yet, a requirement not yet measured, or the newest finding on its requirements. */
export type ThemeStatus = 'not_addressed' | 'in_progress' | 'too_early' | 'worked' | 'needs_attention'
/** How its reach changed from one project to the next (null when there is only one project to look at). */
export type ThemeTrend = 'new' | 'growing' | 'steady' | 'fading' | null
export type PlatformThemeRow = {
  id: string
  title: string
  category: Category
  /** True for a platform theme the model started and nobody has looked at yet. */
  needsReview: boolean
  /** The feature area most of its project themes are filed under, or null when none is (Unassigned). */
  area: { id: string; name: string } | null
  participantCount: number
  projectCount: number
  status: ThemeStatus
  trend: ThemeTrend
  /** Raised again and again, or by several people, and still without a requirement. */
  opportunity: boolean
  /** The requirements written for it, the same requirement in several projects counted once, with the strongest newest finding among them. */
  requirements: { title: string; projectCount: number; result: 'worked' | 'needs_attention' | 'too_early' | null }[]
  /** Per project that raised it: how many of that project's participants did. */
  sources: { projectId: string; participantCount: number }[]
  /** What the theme means, in the words of the project that raised it most (its widest reach); null when no project wrote a description. */
  summary: string | null
  /** The project themes filed under it, with how each was matched and, for the model's matches, why. */
  matches: { themeTitle: string; projectName: string; method: 'auto' | 'manual'; confidence: number | null; reason: string | null }[]
  /** Suggested roadmap order among problems and needs (delights are not ranked): reach and breadth, weighed by what became of it. */
  priority: { rank: number; score: number } | null
  /** Why it ranks where it does, written on request; null until then. */
  rationale: string | null
  /** Old names, from a rename or a merge. */
  aliases: string[]
}
export type MergeSuggestion = { id: string; keep: { id: string; title: string; participantCount: number }; merge: { id: string; title: string; participantCount: number }; reason: string | null; confidence: number | null }
export type Recommendation = {
  id: string
  title: string
  why: string | null
  priority: 'low' | 'medium' | 'high'
  themes: { id: string; title: string }[]
  participantCount: number
  projectCount: number
}
export type ThemesOverview = {
  projects: InsightProject[]
  totalParticipants: number
  summary: { recurring: number; opportunities: number; needsAttention: number; worked: number }
  themes: PlatformThemeRow[]
  recommendations: Recommendation[]
  /** Pairs of platform themes the model (or the word check) thinks say the same thing, waiting for a person to accept or dismiss. */
  mergeSuggestions: MergeSuggestion[]
}
export type InsightQuote = { id: string; text: string; speaker: string; session: string; timestamp: string | null }
export type PlatformThemeDetail = {
  id: string
  title: string
  category: Category
  needsReview: boolean
  participantCount: number
  totalParticipants: number
  projectCount: number
  totalProjects: number
  sources: {
    projectId: string
    projectName: string
    color: string
    participantCount: number
    projectParticipants: number
    matchMethod: 'auto' | 'manual'
  }[]
  /** The one to five quotes that make the theme's point best, from different people where possible. */
  quotes: (InsightQuote & { projectId: string; projectName: string })[]
}
export type CaseStudy = {
  id: string
  title: string
  summary: string | null
  outcome: string | null
  ownerTeam: string | null
  /** First day of the month it happened, as written in the seed (YYYY-MM-DD). */
  date: string | null
  color: string
  themes: { id: string; title: string }[]
  /** A few of the words behind the themes it was based on (up to two, from different people). */
  quotes: { id: string; text: string; speaker: string; session: string }[]
  /** Themes it was based on that are still opportunities. */
  opportunities: number
  /** A request to paste into an AI tool to make the presentation. */
  prompt: string
}

// The same requirement written in several projects is one requirement: titles that match once case and punctuation are ignored are merged,
// keeping how many projects wrote it and the strongest finding among them. (Later, similar titles can be merged here too.)
const FINDING_RANK = { needs_attention: 3, worked: 2, too_early: 1 } as const
export function distinctRequirements(rows: { title: string; projectId: string; result: 'worked' | 'needs_attention' | 'too_early' | null }[]): PlatformThemeRow['requirements'] {
  const merged = new Map<string, { title: string; projects: Set<string>; result: 'worked' | 'needs_attention' | 'too_early' | null }>()
  for (const r of rows) {
    const key = r.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const m = merged.get(key) ?? { title: r.title, projects: new Set<string>(), result: null }
    m.projects.add(r.projectId)
    if ((r.result ? FINDING_RANK[r.result] : 0) > (m.result ? FINDING_RANK[m.result] : 0)) m.result = r.result
    merged.set(key, m)
  }
  return [...merged.values()].map((m) => ({ title: m.title, projectCount: m.projects.size, result: m.result })).sort((a, b) => b.projectCount - a.projectCount || a.title.localeCompare(b.title))
}

// A theme's trend: where it was raised, share of each project's participants, oldest project first.
function trendOf(projects: InsightProject[], sources: { projectId: string; participantCount: number }[]): ThemeTrend {
  if (projects.length < 2 || sources.length === 0) return null
  const share = (projectId: string) => {
    const s = sources.find((x) => x.projectId === projectId)
    const p = projects.find((x) => x.id === projectId)
    return s && p && p.participants > 0 ? s.participantCount / p.participants : 0
  }
  const latest = projects[projects.length - 1]
  const raisedIn = projects.filter((p) => sources.some((s) => s.projectId === p.id))
  if (!sources.some((s) => s.projectId === latest.id)) return 'fading'
  if (raisedIn.length === 1) return 'new'
  const earlier = raisedIn.slice(0, -1)
  const before = earlier.reduce((n, p) => n + share(p.id), 0) / earlier.length
  const change = share(latest.id) - before
  return change >= 0.1 ? 'growing' : change <= -0.1 ? 'fading' : 'steady'
}

// What became of a theme, from the newest finding on each requirement written for it.
function statusOf(results: ('worked' | 'needs_attention' | 'too_early' | null)[]): ThemeStatus {
  if (results.length === 0) return 'not_addressed'
  if (results.includes('needs_attention')) return 'needs_attention'
  if (results.includes('worked')) return 'worked'
  if (results.includes('too_early')) return 'too_early'
  return 'in_progress'
}

export class PlatformThemeNotFound extends Error {}

// Only the latest analysis of each project counts: an earlier run's themes are history.
export const CURRENT_THEMES = `
  select t.id, t.project_id from research.themes t join core.agent_runs r on r.id = t.run_id
  where t.workspace_id = $1 and r.status = 'complete' and r.superseded_at is null`

// A person is one participant per project: matched speakers by participant, unmatched ones by lower-cased name,
// the same key research.theme_stats uses.
const PEOPLE = `
  select s.platform_theme_id, c.project_id, coalesce(sp.participant_id::text, 'sp:' || lower(sp.name)) as person
  from insights.platform_theme_sources s
  join (${CURRENT_THEMES}) c on c.id = s.theme_id
  join research.theme_quotes tq on tq.theme_id = s.theme_id
  join research.utterances u on u.id = tq.utterance_id
  join research.transcript_speakers sp on sp.id = u.speaker_id
  where s.workspace_id = $1`

export async function projectsWithAnalysis(db: Queryable, workspaceId: string): Promise<InsightProject[]> {
  const rows = (
    await db.query(
      `select p.id, p.name, p.color, max(st.total_participants)::int as participants
       from (${CURRENT_THEMES}) c
       join core.projects p on p.id = c.project_id
       join research.theme_stats st on st.theme_id = c.id
       group by p.id, p.name, p.color, p.created_at order by p.created_at, p.name`,
      [workspaceId],
    )
  ).rows
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, participants: r.participants }))
}

// Themes across every analysed project, the recommendations drawn from them, and the numbers behind both.
export async function getThemesOverview(db: Queryable, workspaceId: string): Promise<ThemesOverview> {
  const areaOf = await platformAreaRefs(db, workspaceId)
  const [projects, themeRows, people, recRows, recLinks, storyRows, describedRows, matchRows, aliasRows, suggestionRows] = await Promise.all([
    projectsWithAnalysis(db, workspaceId),
    db.query(`select id, title, category, needs_review, rationale from insights.platform_themes where workspace_id = $1 order by position, title`, [workspaceId]),
    db.query(PEOPLE, [workspaceId]),
    db.query(`select id, title, why, priority from insights.recommendations where workspace_id = $1 order by position, title`, [workspaceId]),
    db.query(
      `select rt.recommendation_id, pt.id as theme_id, pt.title from insights.recommendation_themes rt join insights.platform_themes pt on pt.id = rt.platform_theme_id
       where rt.workspace_id = $1 order by pt.position, pt.title`,
      [workspaceId],
    ),
    db.query(
      `select distinct s.platform_theme_id, st.id as story_id, st.key, st.title, sp.project_id, m.checkins
       from insights.platform_theme_sources s
       join (${CURRENT_THEMES}) c on c.id = s.theme_id
       join delivery.stories st on st.theme_id = s.theme_id and st.kind = 'requirement'
       join delivery.specs sp on sp.id = st.spec_id
       left join delivery.success_measures m on m.story_id = st.id
       where s.workspace_id = $1`,
      [workspaceId],
    ),
    db.query(
      `select s.platform_theme_id, c.project_id, t.description
       from insights.platform_theme_sources s
       join (${CURRENT_THEMES}) c on c.id = s.theme_id
       join research.themes t on t.id = c.id
       where s.workspace_id = $1 and coalesce(trim(t.description), '') <> ''`,
      [workspaceId],
    ),
    db.query(
      `select s.platform_theme_id, s.match_method, s.confidence::float8 as confidence, s.reason, t.title as theme_title, p.name as project_name
       from insights.platform_theme_sources s
       join (${CURRENT_THEMES}) c on c.id = s.theme_id
       join research.themes t on t.id = s.theme_id
       join core.projects p on p.id = c.project_id
       where s.workspace_id = $1 order by p.created_at, p.name, t.title`,
      [workspaceId],
    ),
    db.query(`select platform_theme_id, alias from insights.platform_theme_aliases where workspace_id = $1 order by created_at, alias`, [workspaceId]),
    db.query(`select id, keep_id, merge_id, reason, confidence::float8 as confidence from insights.merge_suggestions where workspace_id = $1 and status = 'pending' order by confidence desc nulls last, created_at`, [workspaceId]),
  ])
  // theme -> project -> people
  const byTheme = new Map<string, Map<string, Set<string>>>()
  for (const r of people.rows) {
    const projectsOf = byTheme.get(r.platform_theme_id) ?? new Map<string, Set<string>>()
    const set = projectsOf.get(r.project_id) ?? new Set<string>()
    set.add(r.person)
    projectsOf.set(r.project_id, set)
    byTheme.set(r.platform_theme_id, projectsOf)
  }
  const count = (themeIds: string[]) => {
    const per = new Map<string, Set<string>>()
    for (const id of themeIds) for (const [project, set] of byTheme.get(id) ?? []) {
      const all = per.get(project) ?? new Set<string>()
      set.forEach((p) => all.add(p))
      per.set(project, all)
    }
    return { participants: [...per.values()].reduce((n, s) => n + s.size, 0), projects: per.size }
  }
  const themes: PlatformThemeRow[] = themeRows.rows.map((t) => {
    const c = count([t.id])
    const sources = [...(byTheme.get(t.id) ?? [])].map(([projectId, set]) => ({ projectId, participantCount: set.size })).sort((a, b) => projects.findIndex((p) => p.id === a.projectId) - projects.findIndex((p) => p.id === b.projectId))
    const requirements = storyRows.rows
      .filter((r) => r.platform_theme_id === t.id)
      .map((r) => {
        const checkins: { verdict: 'worked' | 'needs_attention' | 'too_early' }[] = Array.isArray(r.checkins) ? r.checkins : []
        return { key: r.key as string, title: r.title as string, projectId: r.project_id as string, result: checkins.length ? checkins[checkins.length - 1].verdict : null }
      })
      .sort((a, b) => a.projectId.localeCompare(b.projectId) || (Number(a.key.replace(/\D/g, '')) || 0) - (Number(b.key.replace(/\D/g, '')) || 0))
    const status = statusOf(requirements.map((r) => r.result))
    const distinct = distinctRequirements(requirements)
    const opportunity = status === 'not_addressed' && t.category !== 'delight' && (c.projects >= 2 || c.participants >= 3)
    // The summary is the description written by the project where the most people raised it (the earliest project on a tie).
    const reach = (projectId: string) => sources.find((x) => x.projectId === projectId)?.participantCount ?? 0
    const described = describedRows.rows.filter((r) => r.platform_theme_id === t.id).sort((a, b) => reach(b.project_id) - reach(a.project_id))
    const summary = described.length ? String(described[0].description).trim() : null
    const matches = matchRows.rows.filter((r) => r.platform_theme_id === t.id).slice(0, 12).map((r) => ({ themeTitle: r.theme_title as string, projectName: r.project_name as string, method: r.match_method as 'auto' | 'manual', confidence: (r.confidence ?? null) as number | null, reason: (r.reason ?? null) as string | null }))
    return {
      id: t.id, title: t.title, category: t.category, needsReview: t.needs_review, area: areaOf.get(t.id) ?? null, participantCount: c.participants, projectCount: c.projects, status, trend: trendOf(projects, sources), opportunity, requirements: distinct, sources, summary,
      matches, priority: null, rationale: (t.rationale ?? null) as string | null, aliases: aliasRows.rows.filter((a) => a.platform_theme_id === t.id).map((a) => a.alias as string),
    }
  })
  // Suggested roadmap order: how widely it was raised (people and projects), weighed by what became of it. Delights are not ranked.
  const totalPeople = projects.reduce((n, p) => n + p.participants, 0)
  const scored = themes
    .filter((t) => t.category !== 'delight')
    .map((t) => ({ t, score: priorityScore(t, totalPeople, projects.length) }))
    .sort((a, b) => b.score - a.score || b.t.participantCount - a.t.participantCount || a.t.title.localeCompare(b.t.title))
  scored.forEach((x, i) => (x.t.priority = { rank: i + 1, score: x.score }))
  // Reach first: raised in the most projects, then by the most people.
  themes.sort((a, b) => b.projectCount - a.projectCount || b.participantCount - a.participantCount || a.title.localeCompare(b.title))
  const recommendations: Recommendation[] = recRows.rows.map((r) => {
    const linked = recLinks.rows.filter((l) => l.recommendation_id === r.id)
    const c = count(linked.map((l) => l.theme_id))
    return { id: r.id, title: r.title, why: r.why ?? null, priority: r.priority, themes: linked.map((l) => ({ id: l.theme_id, title: l.title })), participantCount: c.participants, projectCount: c.projects }
  })
  const summary = {
    recurring: themes.filter((t) => t.projectCount >= 2 && t.category !== 'delight').length,
    opportunities: themes.filter((t) => t.opportunity).length,
    needsAttention: themes.filter((t) => t.status === 'needs_attention').length,
    worked: themes.filter((t) => t.status === 'worked').length,
  }
  const byId = new Map(themes.map((t) => [t.id, t]))
  const mergeSuggestions: MergeSuggestion[] = suggestionRows.rows.flatMap((r) => {
    const keep = byId.get(r.keep_id)
    const merge = byId.get(r.merge_id)
    return keep && merge ? [{ id: r.id as string, keep: { id: keep.id, title: keep.title, participantCount: keep.participantCount }, merge: { id: merge.id, title: merge.title, participantCount: merge.participantCount }, reason: (r.reason ?? null) as string | null, confidence: (r.confidence ?? null) as number | null }] : []
  })
  return { projects, totalParticipants: totalPeople, summary, themes, recommendations, mergeSuggestions }
}

const STATUS_WEIGHT: Record<ThemeStatus, number> = { not_addressed: 1, needs_attention: 1.1, in_progress: 0.5, too_early: 0.4, worked: 0.1 }
/** 0 to about 130: reach (60% people, 40% projects) times what became of it, with a bump for opportunities. */
export function priorityScore(t: Pick<PlatformThemeRow, 'participantCount' | 'projectCount' | 'status' | 'opportunity'>, totalPeople: number, totalProjects: number): number {
  const people = totalPeople ? Math.min(1, t.participantCount / totalPeople) : 0
  const projects = totalProjects ? Math.min(1, t.projectCount / totalProjects) : 0
  return Math.round(100 * (0.6 * people + 0.4 * projects) * STATUS_WEIGHT[t.status] * (t.opportunity ? 1.15 : 1))
}

const MAX_QUOTES = 5
const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'for', 'are', 'before', 'without', 'from', 'about', 'when', 'what', 'their', 'they', 'have', 'been', 'into', 'across'])

// How well one line says what the theme says: it uses the theme's own words (its title's and the matcher's keywords) and is a full thought,
// neither a fragment nor a speech.
function pointScore(text: string, title: string): number {
  const lower = text.toLowerCase()
  const words = lower.split(/\s+/).filter(Boolean).length
  const titleWords = [...new Set(title.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 4 && !STOP.has(w)))]
  const stems = titleWords.filter((w) => lower.includes(w.slice(0, Math.max(4, w.length - 2))))
  const keywords = ((PLATFORM_KEYWORDS as Record<string, string[]>)[title] ?? []).filter((k) => new RegExp(k, 'i').test(text))
  return stems.length + keywords.length * 2 + (words >= 8 && words <= 40 ? 1 : 0) - (words < 6 ? 2 : 0) - (words > 60 ? 1 : 0)
}

// The few quotes that carry the theme: best-scoring first, one per person, at most two from the same project, only those nearly as good as the
// best (so a weak theme shows one or two, a strong one up to five).
export function pickQuotes<T extends { id: string; text: string; speaker: string; projectId: string }>(rows: T[], title: string): T[] {
  const scored = rows.map((r, i) => ({ r, i, score: pointScore(r.text, title) })).sort((a, b) => b.score - a.score || a.i - b.i)
  if (!scored.length) return []
  const bar = Math.max(1, scored[0].score * 0.6)
  const picked: typeof scored = []
  for (const s of scored) {
    if (picked.length >= MAX_QUOTES) break
    if (picked.length > 0 && s.score < bar) break
    if (picked.some((p) => p.r.id === s.r.id || p.r.speaker === s.r.speaker) || picked.filter((p) => p.r.projectId === s.r.projectId).length >= 2) continue
    picked.push(s)
  }
  return picked.map((p) => p.r)
}

// One platform theme: which projects raised it and how many of their participants, and the few quotes that make its point.
export async function getPlatformTheme(db: Queryable, workspaceId: string, id: string): Promise<PlatformThemeDetail | undefined> {
  const theme = (await db.query(`select id, title, category, needs_review from insights.platform_themes where id = $1 and workspace_id = $2`, [id, workspaceId])).rows[0]
  if (!theme) return undefined
  const [projects, rows] = await Promise.all([
    projectsWithAnalysis(db, workspaceId),
    db.query(
      `select c.project_id, s.match_method, coalesce(sp.participant_id::text, 'sp:' || lower(sp.name)) as person,
              u.id as utterance_id, u.text, sp.name as speaker, tr.name as session, u.timestamp_label, tr.created_at, u.position
       from insights.platform_theme_sources s
       join (${CURRENT_THEMES}) c on c.id = s.theme_id
       join research.theme_quotes tq on tq.theme_id = s.theme_id
       join research.utterances u on u.id = tq.utterance_id
       join research.transcript_speakers sp on sp.id = u.speaker_id
       join research.transcripts tr on tr.id = u.transcript_id
       where s.workspace_id = $1 and s.platform_theme_id = $2
       order by tr.created_at, tr.name, u.position`,
      [workspaceId, id],
    ),
  ])
  const sources: PlatformThemeDetail['sources'] = []
  for (const p of projects) {
    const mine = rows.rows.filter((r) => r.project_id === p.id)
    if (!mine.length) continue
    sources.push({
      projectId: p.id, projectName: p.name, color: p.color, participantCount: new Set(mine.map((r) => r.person)).size, projectParticipants: p.participants,
      matchMethod: mine.some((r) => r.match_method === 'manual') ? 'manual' : 'auto',
    })
  }
  const nameOf = new Map(projects.map((p) => [p.id, p.name]))
  const seen = new Set<string>()
  const all = rows.rows
    .filter((r) => !seen.has(r.utterance_id) && seen.add(r.utterance_id))
    .map((r) => ({ id: r.utterance_id as string, text: r.text as string, speaker: r.speaker as string, session: r.session as string, timestamp: (r.timestamp_label ?? null) as string | null, projectId: r.project_id as string, projectName: nameOf.get(r.project_id) ?? '' }))
  return {
    id: theme.id, title: theme.title, category: theme.category, needsReview: theme.needs_review,
    participantCount: sources.reduce((n, s) => n + s.participantCount, 0), totalParticipants: projects.reduce((n, p) => n + p.participants, 0),
    projectCount: sources.length, totalProjects: projects.length, sources, quotes: pickQuotes(all, theme.title),
  }
}

export async function listCaseStudies(db: Queryable, workspaceId: string): Promise<CaseStudy[]> {
  const [cases, links, said, overview] = await Promise.all([
    db.query(`select id, title, summary, outcome, owner_team, occurred_on::text as occurred_on, color from insights.case_studies where workspace_id = $1 order by occurred_on desc nulls last, title`, [workspaceId]),
    db.query(
      `select ct.case_study_id, pt.id, pt.title from insights.case_study_themes ct join insights.platform_themes pt on pt.id = ct.platform_theme_id
       where ct.workspace_id = $1 order by pt.position, pt.title`,
      [workspaceId],
    ),
    db.query(
      `select ct.case_study_id, pt.category, u.id as utterance_id, u.text, sp.name as speaker, tr.name as session
       from insights.case_study_themes ct
       join insights.platform_themes pt on pt.id = ct.platform_theme_id
       join insights.platform_theme_sources s on s.platform_theme_id = pt.id
       join (${CURRENT_THEMES}) c on c.id = s.theme_id
       join research.theme_quotes tq on tq.theme_id = s.theme_id
       join research.utterances u on u.id = tq.utterance_id
       join research.transcript_speakers sp on sp.id = u.speaker_id
       join research.transcripts tr on tr.id = u.transcript_id
       where ct.workspace_id = $1
       order by tr.created_at, tr.name, u.position`,
      [workspaceId],
    ),
    getThemesOverview(db, workspaceId),
  ])
  const opportunity = new Set(overview.themes.filter((t) => t.opportunity).map((t) => t.id))
  return cases.rows.map((c) => {
    const themes = links.rows.filter((l) => l.case_study_id === c.id).map((l) => ({ id: l.id as string, title: l.title as string }))
    // Words about a problem first, then anything, from different people.
    const mine = said.rows.filter((r) => r.case_study_id === c.id)
    const quotes: CaseStudy['quotes'] = []
    for (const pass of [(r: Record<string, any>) => r.category !== 'delight', () => true]) {
      for (const r of mine) {
        if (quotes.length >= 2) break
        if (!pass(r) || quotes.some((q) => q.id === r.utterance_id || q.speaker === r.speaker)) continue
        quotes.push({ id: r.utterance_id, text: r.text, speaker: r.speaker, session: String(r.session).replace(/\.\w+$/, '') })
      }
    }
    const study = { title: c.title as string, ownerTeam: (c.owner_team ?? null) as string | null, summary: (c.summary ?? null) as string | null, outcome: (c.outcome ?? null) as string | null }
    return {
      id: c.id, ...study, date: c.occurred_on ?? null, color: c.color, themes, quotes,
      opportunities: themes.filter((t) => opportunity.has(t.id)).length,
      prompt: buildCaseStudyPrompt({ ...study, themes, quotes }),
    }
  })
}

const CURRENT_THEME_ROWS = `select t.id, t.title, t.category, t.description, t.opportunity, (select f.name from insights.feature_areas f where f.id = t.area_id) as area from research.themes t join (${CURRENT_THEMES}) c on c.id = t.id`

// Keeps Platform Insights in step with the projects after each analysis. With a model provider the model places the themes that
// have no platform theme yet (see refreshByModel); otherwise the keyword matcher below re-reads every theme.
export async function refreshPlatformMatches(db: Db, ai: Ai, workspaceId: string): Promise<{ matched: number; created?: number }> {
  return ai.provider.matchPlatform ? refreshByModel(db, ai, workspaceId) : refreshByKeywords(db, ai, workspaceId)
}

type PlatformRow = { id: string; title: string; category: string; aliases: string[]; area?: string | null }

/** The feature area most of each platform theme's project themes are filed under (a tie goes to the name that sorts first), by platform theme id. */
export async function platformAreas(db: Queryable, workspaceId: string): Promise<Map<string, string>> {
  return new Map([...(await platformAreaRefs(db, workspaceId))].map(([id, a]) => [id, a.name]))
}
export async function platformAreaRefs(db: Queryable, workspaceId: string): Promise<Map<string, { id: string; name: string }>> {
  const rows = (
    await db.query(
      `select distinct on (s.platform_theme_id) s.platform_theme_id as id, a.id as area_id, a.name
         from insights.platform_theme_sources s join research.themes th on th.id = s.theme_id join insights.feature_areas a on a.id = th.area_id
        where s.workspace_id = $1 group by s.platform_theme_id, a.id, a.name order by s.platform_theme_id, count(*) desc, a.name`,
      [workspaceId],
    )
  ).rows
  return new Map(rows.map((r) => [r.id as string, { id: r.area_id as string, name: r.name as string }]))
}

// The keyword list is keyed by a theme's original title, so a renamed or merged theme keeps its keywords through its old names.
const keywordsFor = (title: string, aliases: string[] = []): string[] => [...new Set([title, ...aliases].flatMap((t) => PLATFORM_KEYWORDS[t] ?? []))]
const aliasesByTheme = async (db: Queryable, workspaceId: string) => {
  const m = new Map<string, string[]>()
  for (const r of (await db.query(`select platform_theme_id, alias from insights.platform_theme_aliases where workspace_id = $1 order by created_at, alias`, [workspaceId])).rows) m.set(r.platform_theme_id, [...(m.get(r.platform_theme_id) ?? []), r.alias])
  return m
}

// The simulated matcher: re-reads every project's current themes and tags each with the platform theme whose keywords it
// matches best. Automatic tags are replaced; a tag someone set by hand is never touched. Run after each analysis,
// so the Insights numbers follow the projects.
async function refreshByKeywords(db: Db, ai: Ai, workspaceId: string): Promise<{ matched: number }> {
  return db.transaction(async (tx) => {
    const aliases = await aliasesByTheme(tx, workspaceId)
    const areaOfPlatform = await platformAreas(tx, workspaceId) // before the automatic tags are cleared below
    const platform = (await tx.query(`select id, title from insights.platform_themes where workspace_id = $1`, [workspaceId])).rows
      .map((p) => ({ id: p.id as string, keywords: keywordsFor(p.title as string, aliases.get(p.id)) }))
      .filter((p) => p.keywords.length)
    const themes = (await tx.query(CURRENT_THEME_ROWS, [workspaceId])).rows.map((t) => ({ id: t.id as string, title: t.title as string, category: t.category as string, description: t.description ?? '', opportunity: t.opportunity ?? '', area: (t.area as string | null) ?? null }))
    const manual = new Set((await tx.query(`select theme_id from insights.platform_theme_sources where workspace_id = $1 and match_method = 'manual'`, [workspaceId])).rows.map((r) => r.theme_id as string))
    await tx.query(`delete from insights.platform_theme_sources where workspace_id = $1 and match_method = 'auto'`, [workspaceId])
    const raw = await callAi(tx, ai, workspaceId, 'theme_match', (p) => p.matchThemes(themes.filter((t) => !manual.has(t.id)), platform))
    // A match across feature areas needs more confidence than one within an area; below it the theme stays unplaced (this matcher starts nothing).
    const matches = applyAreaRule(raw.map((m: { themeId: string; platformThemeId: string; confidence: number }): Placement => ({ ...m })), { themes, platform: platform.map((p) => ({ id: p.id, title: '', category: '', area: areaOfPlatform.get(p.id) ?? null })) }, 'drop') as { themeId: string; platformThemeId: string; confidence: number }[]
    await insertMany(
      tx,
      'insights.platform_theme_sources',
      matches.map((m) => ({ platform_theme_id: m.platformThemeId, theme_id: m.themeId, workspace_id: workspaceId, match_method: 'auto', confidence: Number(m.confidence.toFixed(2)) })),
    )
    // A manual tag on a theme that is no longer current (its project was re-analysed) goes with it.
    await tx.query(
      `delete from insights.platform_theme_sources s where s.workspace_id = $1 and not exists (select 1 from (${CURRENT_THEMES}) c where c.id = s.theme_id)`,
      [workspaceId],
    )
    return { matched: matches.length }
  })
}

// The model matcher. Only themes that have no platform theme yet are sent, so tags already given stay put (the numbers on the page
// do not shuffle between runs) and each call is small. The model is called before the transaction opens, so a slow call never holds
// a lock and the ledger keeps the cost even if the write fails. A theme the model puts under a title no platform theme has starts a
// new platform theme, flagged for review; at the budget or credit ceiling the keyword matcher stands in and starts nothing.
async function refreshByModel(db: Db, ai: Ai, workspaceId: string): Promise<{ matched: number; created: number }> {
  const aliases = await aliasesByTheme(db, workspaceId)
  const areaOfPlatform = await platformAreas(db, workspaceId)
  const platform: PlatformRow[] = (await db.query(`select id, title, category from insights.platform_themes where workspace_id = $1 order by position, title`, [workspaceId])).rows.map((p) => ({ id: p.id as string, title: p.title as string, category: p.category as string, aliases: aliases.get(p.id) ?? [], area: areaOfPlatform.get(p.id as string) ?? null }))
  const unplaced = (
    await db.query(`${CURRENT_THEME_ROWS} where not exists (select 1 from insights.platform_theme_sources s where s.theme_id = t.id) order by t.created_at, t.title limit ${MAX_THEMES_PER_CALL}`, [workspaceId])
  ).rows.map((t) => ({ id: t.id as string, title: t.title as string, category: t.category as string, description: (t.description ?? '') as string, opportunity: (t.opportunity ?? '') as string, area: (t.area as string | null) ?? null }))

  let placements: Placement[] = []
  if (unplaced.length) {
    const { value } = await callAiWithFallback(db, ai, workspaceId, 'theme_match', async (p) => {
      if (p.matchPlatform) {
        const r = await p.matchPlatform({ themes: unplaced, platform })
        return { value: r.value.placements, usage: r.usage }
      }
      const keyed = platform.map((x) => ({ id: x.id, keywords: keywordsFor(x.title, x.aliases) })).filter((x) => x.keywords.length)
      return { value: applyAreaRule(matchThemes(unplaced, keyed).map((m: { themeId: string; platformThemeId: string; confidence: number }): Placement => ({ ...m })), { themes: unplaced, platform }, 'drop'), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } }
    })
    placements = value
  }

  return db.transaction(async (tx) => {
    // Two analyses finishing together must not both start the same platform theme.
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`platform-match:${workspaceId}`])
    // A tag on a theme that is no longer current (its project was re-analysed) goes with it.
    await tx.query(`delete from insights.platform_theme_sources s where s.workspace_id = $1 and not exists (select 1 from (${CURRENT_THEMES}) c where c.id = s.theme_id)`, [workspaceId])
    const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    const byTitle = new Map<string, string>()
    for (const p of (await tx.query(`select id, title from insights.platform_themes where workspace_id = $1`, [workspaceId])).rows) byTitle.set(norm(String(p.title)), p.id as string)
    for (const a of (await tx.query(`select platform_theme_id, alias from insights.platform_theme_aliases where workspace_id = $1`, [workspaceId])).rows) if (!byTitle.has(norm(String(a.alias)))) byTitle.set(norm(String(a.alias)), a.platform_theme_id as string)
    let matched = 0
    let created = 0
    for (const m of placements) {
      let target = m.platformThemeId
      if (!target && m.newTitle) {
        const key = norm(m.newTitle)
        target = byTitle.get(key)
        if (!target) {
          const made = await tx.query(
            `insert into insights.platform_themes (workspace_id, title, category, needs_review, position)
             select $1, $2, $3, true, coalesce(max(position), 0) + 1 from insights.platform_themes where workspace_id = $1 returning id`,
            [workspaceId, m.newTitle, m.newCategory],
          )
          target = made.rows[0].id as string
          byTitle.set(key, target)
          created++
        }
      }
      if (!target) continue
      // Only a theme that is still current and still untagged is tagged (a hand-made tag is never replaced).
      const res = await tx.query(
        `insert into insights.platform_theme_sources (platform_theme_id, theme_id, workspace_id, match_method, confidence, reason)
         select $3, $2, $1, 'auto', $4, $5 where exists (select 1 from (${CURRENT_THEMES}) c where c.id = $2) and not exists (select 1 from insights.platform_theme_sources where theme_id = $2)
         on conflict do nothing returning theme_id`,
        [workspaceId, m.themeId, target, Number(m.confidence.toFixed(2)), m.reason ?? null],
      )
      matched += res.rows.length
    }
    // A theme the model started and nobody reviewed goes when the research behind it does; reviewed and seeded ones stay.
    await tx.query(`delete from insights.platform_themes p where p.workspace_id = $1 and p.needs_review and not exists (select 1 from insights.platform_theme_sources s where s.platform_theme_id = p.id)`, [workspaceId])
    return { matched, created }
  })
}

/** Marks a model-started platform theme as looked at. Returns false when there is no such theme. */
export async function markThemeReviewed(db: Queryable, workspaceId: string, id: string): Promise<boolean> {
  const r = await db.query(`update insights.platform_themes set needs_review = false, updated_at = now() where id = $1 and workspace_id = $2 returning id`, [id, workspaceId])
  return r.rows.length > 0
}
