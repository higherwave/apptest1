import { PLATFORM_KEYWORDS } from '../shared/platform-keywords.mjs'
import { callAi, type Ai } from './ai.js'
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
}
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
}
export type InsightQuote = { id: string; text: string; speaker: string; session: string; timestamp: string | null }
export type PlatformThemeDetail = {
  id: string
  title: string
  category: Category
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
  const [projects, themeRows, people, recRows, recLinks, storyRows] = await Promise.all([
    projectsWithAnalysis(db, workspaceId),
    db.query(`select id, title, category from insights.platform_themes where workspace_id = $1 order by position, title`, [workspaceId]),
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
    return { id: t.id, title: t.title, category: t.category, participantCount: c.participants, projectCount: c.projects, status, trend: trendOf(projects, sources), opportunity, requirements: distinct, sources }
  })
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
  return { projects, totalParticipants: projects.reduce((n, p) => n + p.participants, 0), summary, themes, recommendations }
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
  const theme = (await db.query(`select id, title, category from insights.platform_themes where id = $1 and workspace_id = $2`, [id, workspaceId])).rows[0]
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
    id: theme.id, title: theme.title, category: theme.category,
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

// The simulated matcher: re-reads every project's current themes and tags each with the platform theme whose keywords it
// matches best. Automatic tags are replaced; a tag someone set by hand is never touched. Run after each analysis,
// so the Insights numbers follow the projects.
export async function refreshPlatformMatches(db: Db, ai: Ai, workspaceId: string): Promise<{ matched: number }> {
  return db.transaction(async (tx) => {
    const platform = (await tx.query(`select id, title from insights.platform_themes where workspace_id = $1`, [workspaceId])).rows
      .map((p) => ({ id: p.id as string, keywords: PLATFORM_KEYWORDS[p.title as string] ?? [] }))
      .filter((p) => p.keywords.length)
    const themes = (
      await tx.query(
        `select t.id, t.title, t.description, t.opportunity from research.themes t join (${CURRENT_THEMES}) c on c.id = t.id`,
        [workspaceId],
      )
    ).rows.map((t) => ({ id: t.id as string, title: t.title as string, description: t.description ?? '', opportunity: t.opportunity ?? '' }))
    const manual = new Set((await tx.query(`select theme_id from insights.platform_theme_sources where workspace_id = $1 and match_method = 'manual'`, [workspaceId])).rows.map((r) => r.theme_id as string))
    await tx.query(`delete from insights.platform_theme_sources where workspace_id = $1 and match_method = 'auto'`, [workspaceId])
    const matches = await callAi(tx, ai, workspaceId, 'theme_match', (p) => p.matchThemes(themes.filter((t) => !manual.has(t.id)), platform))
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
