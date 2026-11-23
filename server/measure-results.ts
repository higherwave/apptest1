// Measure: what happened after launch. Read-only results, grouped by the platform themes the research was filed under (the same themes as Platform Insights), across every
// project the caller can see. A launch's measures are the rolled-up ones set on the Launch tab (server/launch-measures.ts); only a measure with at least one reading appears,
// and so only a theme with something to show. A measure belongs to the themes of the requirements it covers (every requirement of the release when it names none); one
// that reaches no platform theme is listed under "Not yet in a theme". Counts are of measures, so a measure shown under two themes counts under each.
import type { Queryable } from './db.js'
import type { LaunchMeasure } from './launch-measures.js'
import { getLaunchMeasures } from './launch-measures.js'

export type ResultProject = {
  projectId: string
  projectName: string
  teamId: string | null
  teamName: string | null
  launchId: string
  launchName: string
  ownerId: string | null
  ownerName: string | null
  /** The day of the final go; the readings are counted from it. */
  approvedOn: string | null
  /** True when the project is a case study (Platform Insights > Case studies): something worked and nothing needs attention. */
  caseStudy: boolean
  measures: LaunchMeasure[]
}
export type ResultTheme = { id: string | null; title: string; projects: ResultProject[] }
export type MeasureResults = { themes: ResultTheme[] }

/** `visible` is the caller's team ids (null: every team). */
export async function getMeasureResults(db: Queryable, workspaceId: string, visible: string[] | null): Promise<MeasureResults> {
  const params: unknown[] = [workspaceId]
  let scope = ''
  if (visible) {
    params.push(visible)
    scope = ` and p.team_id = any($2::uuid[])`
  }
  const launches = (
    await db.query(
      `select l.id as launch_id, l.name as launch_name, l.project_id, p.name as project_name, p.team_id, t.name as team_name, u.id as owner_id, u.display_name as owner_name,
              (select to_char(a.answered_at at time zone 'UTC', 'YYYY-MM-DD') from delivery.launch_answers a where a.launch_id = l.id and a.step = 'final_decision' order by a.answered_at desc limit 1) as approved_on
         from delivery.launches l
         join core.projects p on p.id = l.project_id
         left join core.teams t on t.id = p.team_id
         left join core.users u on u.id = l.created_by
        where l.workspace_id = $1${scope}`,
      params,
    )
  ).rows
  if (!launches.length) return { themes: [] }
  const ids = launches.map((l) => l.launch_id as string)
  // Only measures that have been read.
  const withReadings = new Set((await db.query(`select id from delivery.launch_measures where launch_id = any($1::uuid[]) and jsonb_array_length(checkins) > 0`, [ids])).rows.map((r) => r.id as string))
  if (!withReadings.size) return { themes: [] }
  const measuresOf = new Map<string, LaunchMeasure[]>()
  for (const id of ids) measuresOf.set(id, (await getLaunchMeasures(db, id)).items.filter((m) => withReadings.has(m.id)))

  // Requirement key -> platform theme ids, for each project (its latest published requirements).
  const projectIds = [...new Set(launches.map((l) => l.project_id as string))]
  const reqRows = (
    await db.query(
      `select sp.project_id, st.key, s.platform_theme_id
         from (select distinct on (project_id) id, project_id from delivery.specs where project_id = any($1::uuid[]) and status = 'published' order by project_id, published_at desc) sp
         join delivery.stories st on st.spec_id = sp.id and st.kind = 'requirement'
         left join insights.platform_theme_sources s on s.theme_id = st.theme_id`,
      [projectIds],
    )
  ).rows
  const themeTitles = new Map((await db.query(`select id, title from insights.platform_themes where workspace_id = $1`, [workspaceId])).rows.map((r) => [r.id as string, r.title as string]))
  const themesOfReq = new Map<string, Map<string, Set<string | null>>>() // project -> key -> platform theme ids (null: not in one)
  for (const r of reqRows) {
    const byKey = themesOfReq.get(r.project_id) ?? new Map<string, Set<string | null>>()
    const set = byKey.get(r.key) ?? new Set<string | null>()
    set.add(r.platform_theme_id && themeTitles.has(r.platform_theme_id) ? (r.platform_theme_id as string) : null)
    byKey.set(r.key, set)
    themesOfReq.set(r.project_id, byKey)
  }

  // A project is a case study once something worked and nothing needs attention (the same rule as the case studies page), and it has an analysis behind it.
  const analysed = new Set((await db.query(`select distinct r.project_id from core.agent_runs r join core.projects p on p.id = r.project_id where r.project_id = any($1::uuid[]) and p.kind = 'research' and r.kind = 'analysis' and r.status = 'complete' and r.superseded_at is null`, [projectIds])).rows.map((r) => r.project_id as string))
  const isCase = (projectId: string, launchId: string) => {
    const results = (measuresOf.get(launchId) ?? []).map((m) => m.result)
    return analysed.has(projectId) && results.includes('worked') && !results.includes('needs_attention')
  }

  const groups = new Map<string | null, Map<string, ResultProject>>()
  for (const l of launches) {
    const byKey = themesOfReq.get(l.project_id) ?? new Map<string, Set<string | null>>()
    for (const m of measuresOf.get(l.launch_id) ?? []) {
      const keys = m.requirementKeys.length ? m.requirementKeys : [...byKey.keys()]
      const themes = new Set<string | null>()
      for (const k of keys) for (const t of byKey.get(k) ?? []) themes.add(t)
      if (!themes.size) themes.add(null)
      for (const t of themes) {
        const projects = groups.get(t) ?? new Map<string, ResultProject>()
        const entry: ResultProject = projects.get(l.launch_id) ?? { projectId: l.project_id, projectName: l.project_name, teamId: l.team_id ?? null, teamName: l.team_name ?? null, launchId: l.launch_id, launchName: l.launch_name, ownerId: l.owner_id ?? null, ownerName: l.owner_name ?? null, approvedOn: l.approved_on ?? null, caseStudy: isCase(l.project_id, l.launch_id), measures: [] }
        entry.measures.push(m)
        projects.set(l.launch_id, entry)
        groups.set(t, projects)
      }
    }
  }
  const themes: ResultTheme[] = [...groups.entries()].map(([id, projects]) => ({
    id,
    title: id ? (themeTitles.get(id) as string) : 'Not yet in a theme',
    projects: [...projects.values()].sort((a, b) => a.projectName.localeCompare(b.projectName, undefined, { sensitivity: 'base' })),
  }))
  // Themes by title, the one that is not a theme last.
  themes.sort((a, b) => (a.id === null ? 1 : b.id === null ? -1 : a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })))
  return { themes }
}
