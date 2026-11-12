// The platform journey: every analysed project's journey map folded into one. Stages with the same name are one stage; each platform
// theme sits in the stage most of its project themes were placed in, so the page reads as where, along the customer's path, the
// pain is, how it feels, and which of it nobody has addressed.
import type { Queryable } from './db.js'
import { currentThemes, getThemesOverview, projectsWithAnalysis, type Category, type ThemeStatus } from './insights.js'
import { listWorkflows, type WorkflowBackstage } from './workflows.js'

export type JourneyTheme = { id: string; title: string; category: Category; participantCount: number; projectCount: number; status: ThemeStatus; opportunity: boolean }
/** A group of participants (by the first part of their role) and what they raised in a stage. */
export type JourneyPersona = { key: string; name: string; participantCount: number; doing: string }
export type JourneyStage = {
  name: string
  /** Projects whose journey map has this stage. */
  projectCount: number
  /** The mean severity of the themes placed here, -1 (very negative) to 1 (very positive); null when none has one. */
  sentiment: number | null
  themes: JourneyTheme[]
  opportunities: number
  /** Only on a workflow's journey: the blueprint's stage, with what good looks like, the signal, the handoff, the backstage, and who is in it. */
  id?: string
  good?: string | null
  signal?: string | null
  handoff?: string | null
  backstage?: WorkflowBackstage[]
  personas?: JourneyPersona[]
}
export type PlatformJourney = { projectCount: number; totalParticipants: number; stages: JourneyStage[]; workflow?: { id: string; name: string; description: string | null; version: number; projects: number } }

export async function getPlatformJourney(db: Queryable, workspaceId: string, visible?: string[] | null): Promise<PlatformJourney> {
  const projects = await projectsWithAnalysis(db, workspaceId, visible)
  if (projects.length === 0) return { projectCount: 0, totalParticipants: 0, stages: [] }
  const [overview, stageRows, placed] = await Promise.all([
    getThemesOverview(db, workspaceId, visible),
    db.query(`select study_id, position, name from research.study_stages where workspace_id = $1 and study_id = any($2::uuid[])`, [workspaceId, projects.map((p) => p.id)]),
    db.query(
      `select s.platform_theme_id, t.project_id, t.severity::float8 as severity, ss.name as stage
       from insights.platform_theme_sources s
       join (${currentThemes(visible)}) c on c.id = s.theme_id
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

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * One workflow's journey: the blueprint's own stages (curated, in order, even where nothing has been found yet), with the research of the projects that are
 * on the workflow laid over them (their journey stages are mapped to the blueprint's), the backstage under each stage, and who is in it. null if there is no such workflow.
 */
export async function getWorkflowJourney(db: Queryable, workspaceId: string, workflowId: string, visible?: string[] | null): Promise<PlatformJourney | null> {
  const flow = (await listWorkflows(db, workspaceId, workflowId, visible))[0]
  if (!flow) return null
  const analysed = await projectsWithAnalysis(db, workspaceId, visible)
  const onFlow = new Set((await db.query(`select project_id from insights.project_workflows where workspace_id = $1 and workflow_id = $2`, [workspaceId, workflowId])).rows.map((r) => r.project_id as string))
  const projects = analysed.filter((p) => onFlow.has(p.id))
  const ids = projects.map((p) => p.id)
  const empty = { themes: [], opportunities: 0, sentiment: null, projectCount: 0, personas: [] }
  const frame = (stage: (typeof flow.stages)[number]) => ({ id: stage.id, name: stage.name, good: stage.good, signal: stage.signal, handoff: stage.handoff, backstage: stage.backstage })
  const workflow = { id: flow.id, name: flow.name, description: flow.description, version: flow.version, projects: flow.projectCount }
  if (ids.length === 0) return { projectCount: 0, totalParticipants: 0, workflow, stages: flow.stages.map((s) => ({ ...empty, ...frame(s) })) }

  const [overview, placed, counts, people] = await Promise.all([
    getThemesOverview(db, workspaceId, visible),
    db.query(
      `select s.platform_theme_id, ss.workflow_stage_id as stage_id, t.severity::float8 as severity
       from insights.platform_theme_sources s
       join (${currentThemes(visible)}) c on c.id = s.theme_id
       join research.themes t on t.id = s.theme_id
       left join research.theme_overrides o on o.theme_id = t.id
       join research.study_stages ss on ss.study_id = t.project_id and ss.position = coalesce(o.stage_position, t.stage_position)
       where s.workspace_id = $1 and t.project_id = any($2::uuid[]) and ss.workflow_stage_id is not null`,
      [workspaceId, ids],
    ),
    db.query(`select workflow_stage_id as stage_id, count(distinct study_id)::int as n from research.study_stages where workspace_id = $1 and study_id = any($2::uuid[]) and workflow_stage_id is not null group by 1`, [workspaceId, ids]),
    db.query(
      `select ss.workflow_stage_id as stage_id, p.id as participant_id, p.role, t.title
       from (${currentThemes(visible)}) c
       join research.themes t on t.id = c.id
       left join research.theme_overrides o on o.theme_id = t.id
       join research.study_stages ss on ss.study_id = t.project_id and ss.position = coalesce(o.stage_position, t.stage_position)
       join research.theme_quotes tq on tq.theme_id = t.id
       join research.utterances u on u.id = tq.utterance_id
       join research.transcript_speakers sp on sp.id = u.speaker_id
       join research.transcripts tr on tr.id = u.transcript_id
       join research.participants p on p.id = sp.participant_id
       where t.project_id = any($2::uuid[]) and ss.workflow_stage_id is not null and tr.source = 'customer' and p.role is not null and btrim(p.role) <> ''`,
      [workspaceId, ids],
    ),
  ])
  const order = new Map(flow.stages.map((s, i) => [s.id, i]))
  // A platform theme sits in the blueprint stage most of its project themes were placed in (the earlier stage on a tie).
  const votes = new Map<string, Map<string, number>>()
  const severities = new Map<string, number[]>()
  for (const r of placed.rows) {
    const v = votes.get(r.platform_theme_id) ?? new Map<string, number>()
    v.set(r.stage_id, (v.get(r.stage_id) ?? 0) + 1)
    votes.set(r.platform_theme_id, v)
    if (r.severity !== null) severities.set(r.stage_id, [...(severities.get(r.stage_id) ?? []), r.severity])
  }
  const stageOfTheme = new Map<string, string>()
  for (const [themeId, v] of votes) stageOfTheme.set(themeId, [...v].sort((a, b) => b[1] - a[1] || (order.get(a[0]) ?? 0) - (order.get(b[0]) ?? 0))[0][0])
  const projectCounts = new Map(counts.rows.map((r) => [r.stage_id as string, r.n as number]))
  // Who is in each stage: participants grouped by the first part of their role, with the theme most of them raised there.
  const groups = new Map<string, Map<string, { name: string; people: Set<string>; titles: Map<string, Set<string>> }>>()
  for (const r of people.rows) {
    const segment = String(r.role).split(',')[0].trim()
    if (!segment) continue
    const inStage = groups.get(r.stage_id) ?? new Map()
    const g = inStage.get(segment.toLowerCase()) ?? { name: upperFirst(segment), people: new Set<string>(), titles: new Map<string, Set<string>>() }
    g.people.add(r.participant_id)
    g.titles.set(r.title, (g.titles.get(r.title) ?? new Set<string>()).add(r.participant_id))
    inStage.set(segment.toLowerCase(), g)
    groups.set(r.stage_id, inStage)
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
  const stages: JourneyStage[] = flow.stages.map((st) => {
    const themes: JourneyTheme[] = overview.themes
      .filter((t) => stageOfTheme.get(t.id) === st.id)
      .map((t) => ({ id: t.id, title: t.title, category: t.category, participantCount: t.participantCount, projectCount: t.projectCount, status: t.status, opportunity: t.opportunity }))
    const sev = severities.get(st.id) ?? []
    const personas: JourneyPersona[] = [...(groups.get(st.id) ?? new Map()).entries()]
      .map(([key, g]) => ({ key, name: g.name, participantCount: g.people.size, doing: [...g.titles].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))[0][0] }))
      .sort((a, b) => b.participantCount - a.participantCount || a.name.localeCompare(b.name))
    return { ...frame(st), projectCount: projectCounts.get(st.id) ?? 0, sentiment: sev.length ? mean(sev) : null, themes, opportunities: themes.filter((t) => t.opportunity).length, personas }
  })
  return { projectCount: projects.length, totalParticipants: projects.reduce((n, p) => n + p.participants, 0), workflow, stages }
}
