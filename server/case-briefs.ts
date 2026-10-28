// Case study material. A brief gathers what a project already knows (the problem, the words of the people, what was decided, the designs
// and what happened after) into one quick view, and the same material becomes a prompt the person pastes into an AI tool such as Claude
// Design to make the presentation themselves, so they control how it looks.
import type { Queryable } from './db.js'
import { getDesign } from './design.js'
import { getMeasure } from './measure.js'
import { NoBoard } from './stories.js'
import { listThemes } from './themes.js'

export type BriefQuote = { text: string; speaker: string; session: string; themeTitle: string | null }
export type CaseBrief = {
  projectId: string
  projectName: string
  template: string | null
  sessions: number
  participants: number
  problem: { title: string; category: string; participantCount: number; totalParticipants: number; description: string | null }[]
  evidence: BriefQuote[]
  decisions: { reasoning: string | null; requirements: { key: string; title: string; priority: string }[]; alternatives: { title: string; reason: string }[] } | null
  designs: { key: string; title: string; prototypeUrl: string | null; notes: string | null }[]
  results: {
    summary: { worked: number; needsAttention: number; tooEarly: number; notMeasured: number }
    items: { key: string; title: string; metric: string | null; source: string | null; baseline: string | null; target: string | null; result: string | null; latest: { on: string; value: string } | null }[]
  } | null
  /** One line on how it turned out, for the row: the best finding, or what has been measured, or where the project stands. */
  outcome: string
  /** The material above as a request to an AI tool. */
  prompt: string
}

const THEMES_SHOWN = 5
const QUOTES_SHOWN = 4
const SOURCE_LABEL: Record<string, string> = { telemetry: 'telemetry', kpi: 'business KPI', support_tickets: 'support tickets', research: 'research', other: 'other' }
const RESULT_LABEL: Record<string, string> = { worked: 'worked', needs_attention: 'needs attention', too_early: 'too early to tell' }

const INSTRUCTIONS = [
  'Make a short presentation (6 to 8 slides) that tells this case study to a wide audience, including people who are not researchers or designers.',
  'Suggested flow: the problem customers had, what we heard (a few of the quotes, word for word), what we decided, what we designed, and what happened.',
  'Use only the facts below. Do not invent numbers, quotes, names or results; where something is missing or still unmeasured, say so plainly.',
  'Keep the slides clean: one idea each, short headlines, and the quotes shown as quotes.',
]

const lines = (title: string, rows: string[]) => (rows.length ? [`## ${title}`, ...rows, ''] : [])

export function buildBriefPrompt(b: Omit<CaseBrief, 'prompt' | 'outcome'>): string {
  return [
    `You are helping me build a case study presentation about "${b.projectName}".`,
    ...INSTRUCTIONS,
    '',
    `Study: ${b.template ?? 'research study'}, ${b.sessions} ${b.sessions === 1 ? 'session' : 'sessions'}, ${b.participants} ${b.participants === 1 ? 'participant' : 'participants'}.`,
    '',
    ...lines('The problem (what customers raised)', b.problem.map((t) => `- ${t.title} (${t.category.replace('_', ' ')}; ${t.participantCount} of ${t.totalParticipants} participants)${t.description ? `: ${t.description}` : ''}`)),
    ...lines('What we heard', b.evidence.map((q) => `- "${q.text}" — ${q.speaker}${q.themeTitle ? `, on "${q.themeTitle}"` : ''}`)),
    ...(b.decisions
      ? lines('What we decided', [
          ...(b.decisions.reasoning ? [b.decisions.reasoning] : []),
          ...b.decisions.requirements.map((r) => `- ${r.key} (${r.priority} priority): ${r.title}`),
          ...b.decisions.alternatives.map((a) => `- Considered and rejected: ${a.title}. ${a.reason}`),
        ])
      : []),
    ...lines('What we designed', b.designs.map((d) => `- ${d.key} ${d.title}${d.prototypeUrl ? ` — prototype: ${d.prototypeUrl}` : ''}${d.notes ? ` — notes: ${d.notes}` : ''}`)),
    ...(b.results
      ? lines(
          'What happened',
          b.results.items.length
            ? b.results.items.map((r) => `- ${r.key} ${r.title}: measured by ${r.metric ?? 'not yet defined'}${r.source ? ` (${SOURCE_LABEL[r.source] ?? r.source})` : ''}; before ${r.baseline ?? 'unknown'}, goal ${r.target ?? 'not set'}; result: ${r.result ? RESULT_LABEL[r.result] : 'not measured yet'}${r.latest ? ` — latest finding (${r.latest.on}): ${r.latest.value}` : ''}`)
            : ['- Nothing has been measured yet.'],
        )
      : []),
  ].join('\n').trim()
}

// How it turned out, in a line: the strongest finding (before to latest), else what is being measured, else where the project stands.
export function outcomeLine(b: Omit<CaseBrief, 'prompt' | 'outcome'>): string {
  const items = b.results?.items ?? []
  const found = items.filter((i) => i.latest)
  if (found.length) {
    const best = [...found].sort((a, c) => (c.result === 'worked' ? 1 : 0) - (a.result === 'worked' ? 1 : 0))[0]
    const label = best.result ? ` (${RESULT_LABEL[best.result]})` : ''
    const more = found.length > 1 ? `, and ${found.length - 1} more` : ''
    return `${best.metric ?? best.title}: ${best.baseline ? `${best.baseline} → ` : ''}${best.latest!.value}${label}${more}`
  }
  const defined = items.filter((i) => i.metric)
  if (defined.length) return `Measuring ${defined[0].metric}${defined[0].target ? `, goal ${defined[0].target}` : ''}${defined.length > 1 ? `, and ${defined.length - 1} more` : ''}. No findings yet.`
  if (b.decisions) return `${b.decisions.requirements.length} requirements decided. Nothing measured yet.`
  return `${b.problem.length} ${b.problem.length === 1 ? 'theme' : 'themes'} from ${b.sessions} ${b.sessions === 1 ? 'session' : 'sessions'}. No requirements published yet.`
}

export async function getCaseBrief(db: Queryable, workspaceId: string, projectId: string): Promise<CaseBrief | undefined> {
  const project = (
    await db.query(
      `select p.id, p.name, tpl.name as template,
              (select count(*) from research.transcripts tr where tr.project_id = p.id)::int as sessions,
              (select count(*) from research.participants pa where pa.project_id = p.id)::int as participants
       from core.projects p left join core.templates tpl on tpl.id = p.template_id
       where p.id = $1 and p.workspace_id = $2 and p.kind = 'research'`,
      [projectId, workspaceId],
    )
  ).rows[0]
  if (!project) return undefined
  const themes = (await listThemes(db, projectId, { quotes: true })).slice(0, THEMES_SHOWN)
  // The words: the strongest themes first, one quote each, then a second round, from different people.
  const evidence: BriefQuote[] = []
  const used = new Set<string>()
  for (let round = 0; round < 2; round++) {
    for (const t of themes) {
      if (evidence.length >= QUOTES_SHOWN) break
      const q = (t.quotes ?? []).find((x) => !used.has(x.id) && (round === 1 || !evidence.some((e) => e.speaker === x.speaker)))
      if (!q) continue
      used.add(q.id)
      evidence.push({ text: q.text, speaker: q.speaker, session: q.session, themeTitle: t.title })
    }
  }
  let design: Awaited<ReturnType<typeof getDesign>> | null = null
  let measure: Awaited<ReturnType<typeof getMeasure>> | null = null
  try {
    design = await getDesign(db, workspaceId, projectId)
    measure = await getMeasure(db, workspaceId, projectId)
  } catch (err) {
    if (!(err instanceof NoBoard)) throw err
  }
  const brief: Omit<CaseBrief, 'prompt' | 'outcome'> = {
    projectId, projectName: project.name, template: project.template ?? null, sessions: project.sessions, participants: project.participants,
    problem: themes.map((t) => ({ title: t.title, category: t.category, participantCount: t.participantCount, totalParticipants: t.totalParticipants, description: t.description })),
    evidence,
    decisions: design
      ? { reasoning: design.decisions.reasoning, requirements: design.items.map((i) => ({ key: i.key, title: i.title, priority: i.priority })), alternatives: design.decisions.alternatives }
      : null,
    designs: (design?.items ?? []).filter((i) => i.prototypeUrl || i.notes).map((i) => ({ key: i.key, title: i.title, prototypeUrl: i.prototypeUrl, notes: i.notes })),
    results: measure
      ? {
          summary: { worked: measure.summary.worked, needsAttention: measure.summary.needsAttention, tooEarly: measure.summary.tooEarly, notMeasured: measure.summary.notMeasured },
          items: measure.items
            .filter((i) => i.metric || i.checkins.length)
            .map((i) => {
              const last = i.checkins[i.checkins.length - 1]
              return { key: i.key, title: i.title, metric: i.metric, source: i.source, baseline: i.baseline, target: i.target, result: i.result, latest: last ? { on: last.on, value: last.value } : null }
            }),
        }
      : null,
  }
  return { ...brief, outcome: outcomeLine(brief), prompt: buildBriefPrompt(brief) }
}

// A brief for every project with a current analysis, newest project first.
export async function listCaseBriefs(db: Queryable, workspaceId: string): Promise<CaseBrief[]> {
  const ids = (
    await db.query(
      `select p.id from core.projects p where p.workspace_id = $1 and p.kind = 'research'
         and exists (select 1 from core.agent_runs r where r.project_id = p.id and r.kind = 'analysis' and r.status = 'complete' and r.superseded_at is null)
       order by p.created_at desc, p.name`,
      [workspaceId],
    )
  ).rows
  const out: CaseBrief[] = []
  for (const r of ids) {
    const b = await getCaseBrief(db, workspaceId, r.id)
    if (b) out.push(b)
  }
  return out
}

// The same request for a case study written by hand (the seeded ones): its summary and outcome, the themes it was based on and some words.
export function buildCaseStudyPrompt(c: { title: string; ownerTeam: string | null; summary: string | null; outcome: string | null; themes: { title: string }[]; quotes: { text: string; speaker: string }[] }): string {
  return [
    `You are helping me build a case study presentation about "${c.title}"${c.ownerTeam ? `, from the ${c.ownerTeam}` : ''}.`,
    ...INSTRUCTIONS,
    '',
    ...lines('What the team did', c.summary ? [c.summary] : []),
    ...lines('The outcome', c.outcome ? [c.outcome] : []),
    ...lines('What customers raised', c.themes.map((t) => `- ${t.title}`)),
    ...lines('What we heard', c.quotes.map((q) => `- "${q.text}" — ${q.speaker}`)),
  ].join('\n').trim()
}
