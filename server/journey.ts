// The platform journey: every analysed project's journey map folded into one. Stages with the same name are one stage; each platform
// theme sits in the stage most of its project themes were placed in, so the page reads as where, along the customer's path, the
// pain is, how it feels, and which of it nobody has addressed.
import type { Queryable } from './db.js'
import { CURRENT_THEMES, getThemesOverview, projectsWithAnalysis, type Category, type ThemeStatus } from './insights.js'

export type JourneyTheme = { id: string; title: string; category: Category; participantCount: number; projectCount: number; status: ThemeStatus; opportunity: boolean }
export type JourneyStage = {
  name: string
  /** Projects whose journey map has this stage. */
  projectCount: number
  /** The mean severity of the themes placed here, -1 (very negative) to 1 (very positive); null when none has one. */
  sentiment: number | null
  themes: JourneyTheme[]
  opportunities: number
}
export type PlatformJourney = { projectCount: number; totalParticipants: number; stages: JourneyStage[] }

export async function getPlatformJourney(db: Queryable, workspaceId: string): Promise<PlatformJourney> {
  const projects = await projectsWithAnalysis(db, workspaceId)
  if (projects.length === 0) return { projectCount: 0, totalParticipants: 0, stages: [] }
  const [overview, stageRows, placed] = await Promise.all([
    getThemesOverview(db, workspaceId),
    db.query(`select study_id, position, name from research.study_stages where workspace_id = $1 and study_id = any($2::uuid[])`, [workspaceId, projects.map((p) => p.id)]),
    db.query(
      `select s.platform_theme_id, t.project_id, t.severity::float8 as severity, ss.name as stage
       from insights.platform_theme_sources s
       join (${CURRENT_THEMES}) c on c.id = s.theme_id
       join research.themes t on t.id = s.theme_id
       left join research.theme_overrides o on o.theme_id = t.id
       join research.study_stages ss on ss.study_id = t.project_id and ss.position = coalesce(o.stage_position, t.stage_position)
       where s.workspace_id = $1`,
      [workspaceId],
    ),
  ])
  // The stages: one per name, in the order they come along the path (their mean position across the projects that have them).
  const stages = new Map<string, { name: string; positions: number[]; projects: Set<string> }>()
  for (const r of stageRows.rows) {
    const key = String(r.name).trim().toLowerCase()
    const s = stages.get(key) ?? { name: String(r.name).trim(), positions: [], projects: new Set<string>() }
    s.positions.push(r.position)
    s.projects.add(r.study_id)
    stages.set(key, s)
  }
  // A platform theme sits in the stage most of its project themes were placed in (the earlier stage on a tie).
  const votes = new Map<string, Map<string, number>>()
  const severities = new Map<string, number[]>()
  for (const r of placed.rows) {
    const key = String(r.stage).trim().toLowerCase()
    const v = votes.get(r.platform_theme_id) ?? new Map<string, number>()
    v.set(key, (v.get(key) ?? 0) + 1)
    votes.set(r.platform_theme_id, v)
    if (r.severity !== null) severities.set(key, [...(severities.get(key) ?? []), r.severity])
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const order = [...stages].map(([key, s]) => ({ key, ...s, at: mean(s.positions) })).sort((a, b) => a.at - b.at || a.name.localeCompare(b.name))
  const stageOfTheme = new Map<string, string>()
  for (const [themeId, v] of votes) {
    const best = [...v].sort((a, b) => b[1] - a[1] || order.findIndex((o) => o.key === a[0]) - order.findIndex((o) => o.key === b[0]))[0]
    stageOfTheme.set(themeId, best[0])
  }
  const out: JourneyStage[] = order.map((s) => {
    const themes: JourneyTheme[] = overview.themes
      .filter((t) => stageOfTheme.get(t.id) === s.key)
      .map((t) => ({ id: t.id, title: t.title, category: t.category, participantCount: t.participantCount, projectCount: t.projectCount, status: t.status, opportunity: t.opportunity }))
    const sev = severities.get(s.key) ?? []
    return { name: s.name, projectCount: s.projects.size, sentiment: sev.length ? mean(sev) : null, themes, opportunities: themes.filter((t) => t.opportunity).length }
  })
  return { projectCount: projects.length, totalParticipants: projects.reduce((n, p) => n + p.participants, 0), stages: out }
}
