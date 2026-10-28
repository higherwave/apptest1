// Customer profiles: the participants of every analysed project, grouped by who they are (the text of their role before the first
// comma, so "Working parent, new patient" and "Working parent" are one group), with what that group struggles with and what they said.
import type { Queryable } from './db.js'
import { CURRENT_THEMES, getThemesOverview, projectsWithAnalysis, type Category, type ThemeStatus } from './insights.js'

export type CustomerQuote = { id: string; text: string; speaker: string; session: string; projectId: string; themeTitle: string }
export type CustomerGroup = {
  key: string
  name: string
  participantCount: number
  projectCount: number
  projects: { id: string; name: string; color: string }[]
  /** The full roles inside the group, as the test plans wrote them. */
  roles: string[]
  /** What most of them raised, widest first. */
  themes: { id: string; title: string; category: Category; participantCount: number; status: ThemeStatus; opportunity: boolean }[]
  quotes: CustomerQuote[]
  opportunities: number
}
export type Customers = { totalParticipants: number; groups: CustomerGroup[] }

const THEMES_SHOWN = 5
const QUOTES_SHOWN = 3

const segmentOf = (role: string) => role.split(',')[0].trim()
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export async function getCustomers(db: Queryable, workspaceId: string): Promise<Customers> {
  const projects = await projectsWithAnalysis(db, workspaceId)
  const ids = projects.map((p) => p.id)
  if (ids.length === 0) return { totalParticipants: 0, groups: [] }
  const [overview, people, said] = await Promise.all([
    getThemesOverview(db, workspaceId),
    db.query(`select id, project_id, role from research.participants where workspace_id = $1 and project_id = any($2::uuid[]) and role is not null and btrim(role) <> ''`, [workspaceId, ids]),
    db.query(
      `select sp.participant_id, s.platform_theme_id, u.id as utterance_id, u.text, sp.name as speaker, tr.name as session, c.project_id, tr.created_at, u.position
       from insights.platform_theme_sources s
       join (${CURRENT_THEMES}) c on c.id = s.theme_id
       join research.theme_quotes tq on tq.theme_id = s.theme_id
       join research.utterances u on u.id = tq.utterance_id
       join research.transcript_speakers sp on sp.id = u.speaker_id
       join research.transcripts tr on tr.id = u.transcript_id
       where s.workspace_id = $1 and sp.participant_id is not null
       order by tr.created_at, tr.name, u.position`,
      [workspaceId],
    ),
  ])
  const themeById = new Map(overview.themes.map((t) => [t.id, t]))
  const groups = new Map<string, { name: string; participants: Set<string>; projects: Set<string>; roles: Set<string> }>()
  const groupOf = new Map<string, string>()
  for (const p of people.rows) {
    const segment = segmentOf(p.role)
    if (!segment) continue
    const key = segment.toLowerCase()
    const g = groups.get(key) ?? { name: upperFirst(segment), participants: new Set(), projects: new Set(), roles: new Set() }
    g.participants.add(p.id)
    g.projects.add(p.project_id)
    g.roles.add(p.role.trim())
    groups.set(key, g)
    groupOf.set(p.id, key)
  }
  const out: CustomerGroup[] = []
  for (const [key, g] of groups) {
    // Who in this group raised which theme, and what they said.
    const raised = new Map<string, Set<string>>()
    const quotes: (CustomerQuote & { category: Category })[] = []
    const seen = new Set<string>()
    for (const r of said.rows) {
      if (groupOf.get(r.participant_id) !== key) continue
      const theme = themeById.get(r.platform_theme_id)
      if (!theme) continue
      const set = raised.get(theme.id) ?? new Set<string>()
      set.add(r.participant_id)
      raised.set(theme.id, set)
      if (!seen.has(r.utterance_id)) {
        seen.add(r.utterance_id)
        quotes.push({ id: r.utterance_id, text: r.text, speaker: r.speaker, session: r.session, projectId: r.project_id, themeTitle: theme.title, category: theme.category })
      }
    }
    const themes = [...raised].map(([id, set]) => {
      const t = themeById.get(id)!
      return { id, title: t.title, category: t.category, participantCount: set.size, status: t.status, opportunity: t.opportunity }
    }).sort((a, b) => b.participantCount - a.participantCount || a.title.localeCompare(b.title))
    // Words about a problem first, from different people, then anything else.
    const byPerson = new Set<string>()
    const picked: CustomerQuote[] = []
    for (const pass of [(q: { category: Category }) => q.category !== 'delight', () => true]) {
      for (const q of quotes) {
        if (picked.length >= QUOTES_SHOWN) break
        if (picked.some((x) => x.id === q.id) || !pass(q) || byPerson.has(q.speaker + q.themeTitle)) continue
        byPerson.add(q.speaker + q.themeTitle)
        picked.push({ id: q.id, text: q.text, speaker: q.speaker, session: q.session, projectId: q.projectId, themeTitle: q.themeTitle })
      }
    }
    out.push({
      key, name: g.name, participantCount: g.participants.size, projectCount: g.projects.size,
      projects: projects.filter((p) => g.projects.has(p.id)).map((p) => ({ id: p.id, name: p.name, color: p.color })),
      roles: [...g.roles].sort(), themes: themes.slice(0, THEMES_SHOWN), quotes: picked, opportunities: themes.filter((t) => t.opportunity).length,
    })
  }
  out.sort((a, b) => b.participantCount - a.participantCount || a.name.localeCompare(b.name))
  return { totalParticipants: out.reduce((n, g) => n + g.participantCount, 0), groups: out }
}
