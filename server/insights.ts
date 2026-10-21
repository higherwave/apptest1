import { PLATFORM_KEYWORDS } from '../shared/platform-keywords.mjs'
import { callAi, type Ai } from './ai.js'
import type { Db, Queryable } from './db.js'
import { insertMany } from './sql.js'

export type Category = 'pain_point' | 'need' | 'expectation' | 'delight'
export type InsightProject = { id: string; name: string; color: string; participants: number }
export type PlatformThemeRow = {
  id: string
  title: string
  category: Category
  participantCount: number
  projectCount: number
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
    quotes: InsightQuote[]
  }[]
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
}

export class PlatformThemeNotFound extends Error {}

// Only the latest analysis of each project counts: an earlier run's themes are history.
const CURRENT_THEMES = `
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

async function projectsWithAnalysis(db: Queryable, workspaceId: string): Promise<InsightProject[]> {
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
  const [projects, themeRows, people, recRows, recLinks] = await Promise.all([
    projectsWithAnalysis(db, workspaceId),
    db.query(`select id, title, category from insights.platform_themes where workspace_id = $1 order by position, title`, [workspaceId]),
    db.query(PEOPLE, [workspaceId]),
    db.query(`select id, title, why, priority from insights.recommendations where workspace_id = $1 order by position, title`, [workspaceId]),
    db.query(
      `select rt.recommendation_id, pt.id as theme_id, pt.title from insights.recommendation_themes rt join insights.platform_themes pt on pt.id = rt.platform_theme_id
       where rt.workspace_id = $1 order by pt.position, pt.title`,
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
    return {
      id: t.id, title: t.title, category: t.category, participantCount: c.participants, projectCount: c.projects,
      sources: [...(byTheme.get(t.id) ?? [])].map(([projectId, set]) => ({ projectId, participantCount: set.size })).sort((a, b) => projects.findIndex((p) => p.id === a.projectId) - projects.findIndex((p) => p.id === b.projectId)),
    }
  })
  const recommendations: Recommendation[] = recRows.rows.map((r) => {
    const linked = recLinks.rows.filter((l) => l.recommendation_id === r.id)
    const c = count(linked.map((l) => l.theme_id))
    return { id: r.id, title: r.title, why: r.why ?? null, priority: r.priority, themes: linked.map((l) => ({ id: l.theme_id, title: l.title })), participantCount: c.participants, projectCount: c.projects }
  })
  return { projects, totalParticipants: projects.reduce((n, p) => n + p.participants, 0), themes, recommendations }
}

const QUOTES_PER_PROJECT = 3

// One platform theme, with where it came from: per project, how many participants raised it and some of what they said.
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
    const seen = new Set<string>()
    const quotes: InsightQuote[] = []
    for (const r of mine) {
      if (seen.has(r.utterance_id) || quotes.length >= QUOTES_PER_PROJECT) continue
      seen.add(r.utterance_id)
      quotes.push({ id: r.utterance_id, text: r.text, speaker: r.speaker, session: r.session, timestamp: r.timestamp_label ?? null })
    }
    sources.push({
      projectId: p.id, projectName: p.name, color: p.color, participantCount: new Set(mine.map((r) => r.person)).size, projectParticipants: p.participants,
      matchMethod: mine.some((r) => r.match_method === 'manual') ? 'manual' : 'auto', quotes,
    })
  }
  return {
    id: theme.id, title: theme.title, category: theme.category,
    participantCount: sources.reduce((n, s) => n + s.participantCount, 0), totalParticipants: projects.reduce((n, p) => n + p.participants, 0),
    projectCount: sources.length, totalProjects: projects.length, sources,
  }
}

export async function listCaseStudies(db: Queryable, workspaceId: string): Promise<CaseStudy[]> {
  const [cases, links] = await Promise.all([
    db.query(`select id, title, summary, outcome, owner_team, occurred_on::text as occurred_on, color from insights.case_studies where workspace_id = $1 order by occurred_on desc nulls last, title`, [workspaceId]),
    db.query(
      `select ct.case_study_id, pt.id, pt.title from insights.case_study_themes ct join insights.platform_themes pt on pt.id = ct.platform_theme_id
       where ct.workspace_id = $1 order by pt.position, pt.title`,
      [workspaceId],
    ),
  ])
  return cases.rows.map((c) => ({
    id: c.id, title: c.title, summary: c.summary ?? null, outcome: c.outcome ?? null, ownerTeam: c.owner_team ?? null, date: c.occurred_on ?? null, color: c.color,
    themes: links.rows.filter((l) => l.case_study_id === c.id).map((l) => ({ id: l.id, title: l.title })),
  }))
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
