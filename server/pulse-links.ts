// Pulse and Signal Flow point at each other instead of copying each other (links, not duplicates): a topic says which projects were started from it and which Platform Insights themes
// already cover it ("already researched"), and a theme can say which topics heard the same thing. Matching a topic to a theme is a simulated, deterministic reading of the words
// (the same `terms` the topic grouping uses), ready to be replaced by the AI provider seam.
import type { Queryable } from './db.js'
import { terms } from './pulse-topics.js'

export type TopicLinks = {
  /** Projects started from the topic (a project that was deleted drops out by itself). */
  projects: { id: string; name: string }[]
  /** Platform Insights themes that already cover what the topic is about. */
  researched: { id: string; title: string }[]
}

type ThemeRow = { id: string; title: string }

const MAX_THEMES = 2
const NEED = 0.6

/** The themes whose title words are mostly found in the topic's own words (its title and its signals). A one-word theme title needs that word to be used by at least two signals. */
export function matchThemes(topic: { title: string; bodies: string[] }, themes: ThemeRow[]): ThemeRow[] {
  const inTitle = new Set(terms(topic.title))
  const perSignal = topic.bodies.map((b) => new Set(terms(b)))
  const all = new Set([...inTitle, ...perSignal.flatMap((s) => [...s])])
  const scored: { t: ThemeRow; score: number }[] = []
  for (const t of themes) {
    const words = [...new Set(terms(t.title))]
    if (!words.length) continue
    const hit = words.filter((w) => all.has(w))
    if (hit.length / words.length < NEED) continue
    if (words.length === 1 && !inTitle.has(words[0]) && perSignal.filter((s) => s.has(words[0])).length < 2) continue
    scored.push({ t, score: hit.length / words.length + hit.length * 0.01 })
  }
  return scored.sort((a, b) => b.score - a.score || a.t.title.localeCompare(b.t.title)).slice(0, MAX_THEMES).map((s) => s.t)
}

/** Links for several topics at once. `bodies` are each topic's kept signals. Owners only reach this (Pulse is owners-only), so every project and theme is visible to the caller. */
export async function linksFor(db: Queryable, workspaceId: string, topics: { id: string; title: string; bodies: string[] }[]): Promise<Map<string, TopicLinks>> {
  const out = new Map<string, TopicLinks>(topics.map((t) => [t.id, { projects: [], researched: [] }]))
  if (!topics.length) return out
  const made = (
    await db.query(
      `select l.topic_id, p.id, p.name from core.pulse_project_links l join core.projects p on p.id = l.project_id
        where l.workspace_id = $1 and l.topic_id = any($2::uuid[]) order by p.created_at, p.name`,
      [workspaceId, topics.map((t) => t.id)],
    )
  ).rows
  for (const r of made) out.get(r.topic_id)?.projects.push({ id: r.id, name: r.name })
  const themes = (await db.query(`select id, title from insights.platform_themes where workspace_id = $1 order by position, title`, [workspaceId])).rows as ThemeRow[]
  for (const t of topics) out.get(t.id)!.researched = matchThemes(t, themes)
  return out
}
