// Storyboard: a project's research as a short deck for product leaders. The facts (who was studied, the strongest themes and a customer's own
// words for each) are read live, so the deck never drifts from the project. What a model writes (ai-storyboard.ts) is saved once and shown to
// everyone until an owner or editor generates it again. Nobody edits the text in the app; it is downloaded and changed elsewhere.
import { callAiWithFallback, type Ai, type Fallback } from './ai.js'
import { STORYBOARD_THEMES, templateStoryboard, type StoryboardDraft, type StoryboardInput } from './ai-storyboard.js'
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { listThemes } from './themes.js'

const FREE = { inputTokens: 0, outputTokens: 0, costUsd: 0 }
const SHOWN_TASKS = 6

export type StoryboardTheme = { id: string; title: string; category: string; participants: number; totalParticipants: number; quote: { text: string; /** Who said it, by role, never by name: the deck goes to people outside the research. */ who: string } | null }
export type StoryboardFacts = {
  projectName: string
  participants: number
  sessions: number
  roles: { role: string; count: number }[]
  tasks: string[]
  /** First and last session date (yyyy-mm-dd), when the participants have dates. */
  when: { from: string; to: string } | null
  /** The strongest themes, most important first; the deck shows the first five and the solutions cite from these. */
  themes: StoryboardTheme[]
  themeCount: number
}
export type StoryboardSolution = Omit<StoryboardDraft['solutions'][number], 'themes'> & { themes: { id: string; title: string }[] }
export type Storyboard = {
  facts: StoryboardFacts
  draft: (Omit<StoryboardDraft, 'solutions'> & { solutions: StoryboardSolution[]; source: 'model' | 'template'; generatedAt: string }) | null
  /** Set on a generate that fell back to the plain draft because the month's budget or the account's credit was used up. */
  fallback?: Fallback
}

export class NoStoryboardProject extends Error {}

type Gathered = { facts: StoryboardFacts; input: StoryboardInput }

async function gather(db: Queryable, workspaceId: string, projectId: string): Promise<Gathered | undefined> {
  const project = (await db.query(`select name from core.projects where id = $1 and workspace_id = $2 and kind = 'research'`, [projectId, workspaceId])).rows[0]
  if (!project) return undefined
  const sessions = (await db.query(`select count(*)::int as n from research.transcripts where project_id = $1`, [projectId])).rows[0].n as number
  const people = (await db.query(`select role, count(*)::int as n, min(session_date)::text as first, max(session_date)::text as last from research.participants where project_id = $1 group by role`, [projectId])).rows
  const participants = people.reduce((n, r) => n + (r.n as number), 0)
  const roles = people.filter((r) => r.role).map((r) => ({ role: r.role as string, count: r.n as number })).sort((a, b) => b.count - a.count || a.role.localeCompare(b.role))
  const dates = people.flatMap((r) => [r.first, r.last]).filter(Boolean).sort() as string[]
  const roleByName = new Map((await db.query(`select lower(name) as name, role from research.participants where project_id = $1 and role is not null`, [projectId])).rows.map((r) => [r.name as string, r.role as string]))
  const tasks = (await db.query(`select prompt from research.tasks where project_id = $1 and parent_task_id is null order by position limit $2`, [projectId, SHOWN_TASKS])).rows.map((r) => r.prompt as string)
  const all = await listThemes(db, projectId, { quotes: true })
  const themes = all.slice(0, STORYBOARD_THEMES)
  const quoteOf = (t: (typeof themes)[number]) => (t.quotes ?? []).find((q) => q.source === 'customer')
  const facts: StoryboardFacts = {
    projectName: project.name,
    participants,
    sessions,
    roles,
    tasks,
    when: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
    themes: themes.map((t) => {
      const q = quoteOf(t)
      return { id: t.id, title: t.title, category: t.category, participants: t.participantCount, totalParticipants: t.totalParticipants, quote: q ? { text: q.text, who: roleByName.get(q.speaker.toLowerCase()) ?? 'Participant' } : null }
    }),
    themeCount: all.length,
  }
  const input: StoryboardInput = {
    projectName: facts.projectName,
    participants,
    roles,
    tasks,
    themes: themes.map((t) => ({ id: t.id, title: t.title, category: t.category, participants: t.participantCount, totalParticipants: t.totalParticipants, description: t.description, opportunity: t.opportunity, quotes: (t.quotes ?? []).filter((q) => q.source === 'customer').map((q) => q.text) })),
  }
  return { facts, input }
}

async function saved(db: Queryable, projectId: string, facts: StoryboardFacts): Promise<Storyboard['draft']> {
  const row = (await db.query(`select draft, source, generated_at from research.storyboards where project_id = $1`, [projectId])).rows[0]
  if (!row) return null
  const d = row.draft as StoryboardDraft
  const title = new Map(facts.themes.map((t) => [t.id, t.title]))
  return {
    headline: d.headline,
    problem: d.problem,
    // A theme that has since gone from the project's strongest few is dropped from a solution's chips rather than shown without a name.
    solutions: d.solutions.map((s) => ({ ...s, themes: s.themes.filter((id) => title.has(id)).map((id) => ({ id, title: title.get(id)! })) })),
    recommendation: d.recommendation,
    source: row.source,
    generatedAt: new Date(row.generated_at).toISOString(),
  }
}

/** The deck for a project: the live facts and the saved text (null until generated). Undefined when there is no such research project. */
export async function getStoryboard(db: Queryable, workspaceId: string, projectId: string): Promise<Storyboard | undefined> {
  const g = await gather(db, workspaceId, projectId)
  if (!g) return undefined
  return { facts: g.facts, draft: await saved(db, projectId, g.facts) }
}

export class NoThemesYet extends Error {}

type Written = { draft: StoryboardDraft; version: string; source: 'model' | 'template' }

/** Writes the deck's text (or writes it again) and saves it. A model that cannot be used leaves the plain draft in its place; an unusable reply saves nothing. */
export async function generateStoryboard(db: Db, ai: Ai, ctx: Pick<RequestContext, 'workspaceId' | 'userId' | 'anonymous'>, projectId: string): Promise<Storyboard> {
  const g = await gather(db, ctx.workspaceId, projectId)
  if (!g) throw new NoStoryboardProject()
  if (!g.input.themes.length) throw new NoThemesYet()
  const { value, fallback } = await callAiWithFallback<Written>(db, ai, ctx.workspaceId, 'storyboard', async (p) => {
    if (p.writeStoryboard) {
      const r = await p.writeStoryboard(g.input)
      return { value: { draft: r.value.draft, version: r.value.promptVersion, source: 'model' }, usage: r.usage }
    }
    return { value: { draft: templateStoryboard(g.input), version: 'storyboard-template-v1', source: 'template' }, usage: FREE }
  })
  await db.query(
    `insert into research.storyboards (project_id, workspace_id, draft, prompt_version, source, generated_at, generated_by) values ($1, $2, $3, $4, $5, now(), $6)
     on conflict (project_id) do update set draft = excluded.draft, prompt_version = excluded.prompt_version, source = excluded.source, generated_at = now(), generated_by = excluded.generated_by`,
    [projectId, ctx.workspaceId, JSON.stringify(value.draft), value.version, value.source, ctx.anonymous ? null : ctx.userId],
  )
  return { facts: g.facts, draft: await saved(db, projectId, g.facts), ...(fallback ? { fallback } : {}) }
}

