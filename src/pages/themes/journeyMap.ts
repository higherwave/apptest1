import type { Theme } from '../../api/client'

// What the Journey Map shows for one stage, worked out from the themes placed in it. No React in here, so it is easy to test.
const RANK = { low: 1, medium: 2, high: 3 } as const

// Strongest first: higher importance, then more people. Ties keep the order the API gave (strongest by score).
export const strongestFirst = (themes: Theme[]): Theme[] =>
  themes
    .map((t, i) => ({ t, i }))
    .sort((a, b) => RANK[b.t.priority as keyof typeof RANK] - RANK[a.t.priority as keyof typeof RANK] || b.t.participantCount - a.t.participantCount || a.i - b.i)
    .map((x) => x.t)

// The stage's opportunity is the strongest theme's: one sentence per stage, not a list.
export const stageOpportunity = (themes: Theme[]): string | null => {
  const top = strongestFirst(themes)[0]
  return top ? (top.opportunity ?? `Address: ${top.title}`) : null
}

// The pain points raised in the stage, strongest first.
export const stagePainPoints = (themes: Theme[]): Theme[] => strongestFirst(themes.filter((t) => t.category === 'pain_point'))

// Sentiment is the mean severity of the stage's themes (-1 very negative to 1 very positive); null when no theme has one.
export function stageSentiment(themes: Theme[]): number | null {
  const values = themes.map((t) => t.severity).filter((v): v is number => v !== null)
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

// Where a sentiment sits in the chart, as a percentage from the top: positive high, negative low, zero in the middle.
export const sentimentTop = (sentiment: number): number => 50 - Math.max(-1, Math.min(1, sentiment)) * 40

// The Backstage row is a simulation: nothing in the research says who or what works behind a stage, so each one is inferred from the words in
// the stage's name and its themes (a team, a system or a process per hit, strongest match first). It shows what a blueprint would look like.
export type Backstage = { kind: 'Team' | 'System' | 'Process'; text: string }

const BACKSTAGE: { words: RegExp; items: Backstage[] }[] = [
  { words: /schedul|book|appointment|availab|slot|calendar|reschedul/i, items: [{ kind: 'Team', text: 'Scheduling team' }, { kind: 'System', text: 'Booking and calendar system' }] },
  { words: /remind|notif|message|text|email|call|reach/i, items: [{ kind: 'System', text: 'Messaging service' }, { kind: 'Team', text: 'Patient communications' }] },
  { words: /pay|bill|fee|insur|invoice|cost|price|confirm/i, items: [{ kind: 'Team', text: 'Billing and insurance team' }, { kind: 'System', text: 'Payments platform' }] },
  { words: /check.?in|arriv|front desk|wait|intake|form|prepare/i, items: [{ kind: 'Team', text: 'Front desk staff' }, { kind: 'Process', text: 'Intake and check-in workflow' }] },
  { words: /follow|visit|care|record|chart|note|result/i, items: [{ kind: 'System', text: 'Patient records (EHR)' }, { kind: 'Team', text: 'Care team' }] },
  { words: /report|dashboard|score|data|analytic|metric|health/i, items: [{ kind: 'System', text: 'Reporting and analytics' }, { kind: 'Team', text: 'Operations analytics' }] },
  { words: /handoff|hand.?off|support|success|renew|account|customer|context/i, items: [{ kind: 'Team', text: 'Support and success' }, { kind: 'System', text: 'CRM and case history' }] },
]

// Up to three backstage entries for a stage; none for a stage with no themes (nothing to infer from). A stage whose words match nothing falls back to operations.
export function stageBackstage(stageName: string, themes: Theme[]): Backstage[] {
  if (themes.length === 0) return []
  const text = [stageName, ...themes.flatMap((t) => [t.title, t.description ?? ''])].join(' ')
  const scored = BACKSTAGE.map((b, order) => ({ b, order, hits: (text.match(new RegExp(b.words.source, 'gi')) ?? []).length }))
    .filter((x) => x.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.order - b.order)
  const out: Backstage[] = []
  for (const { b } of scored) for (const item of b.items) if (out.length < 3 && !out.some((o) => o.text === item.text)) out.push(item)
  return out.length ? out : [{ kind: 'Team', text: 'Operations team' }]
}

// The User flow row is a simulation too. It follows a customer through the stage as a short chain of steps, worked out from the themes placed in it:
// where they start, the strongest things they run into (friction, a delight, something they expect), a decision point where the stage reads
// negative or a serious pain point was raised, then where they go next. Each step keeps the sentiment of the theme it came from.
// It folds the journey map, a blueprint's backstage and a user flow into one view, so it is only as accurate as the themes are.
export type FlowStep = { kind: 'Start' | 'Friction' | 'Delight' | 'Expectation' | 'Decision'; text: string; tone: 'negative' | 'positive' | 'neutral'; note?: string }
export type StageFlow = { sentiment: 'Negative' | 'Mixed' | 'Positive' | null; steps: FlowStep[]; next: string | null }

// The stage's overall feel in a word, from its mean severity; null when no theme has one.
export function sentimentWord(sentiment: number | null): StageFlow['sentiment'] {
  return sentiment === null ? null : sentiment < -0.15 ? 'Negative' : sentiment > 0.15 ? 'Positive' : 'Mixed'
}

// Up to four steps for a stage, none when it has no themes (nothing to follow). `next` is the following stage's name, null at the end of the journey.
export function stageFlow(stageName: string, themes: Theme[], next: string | null): StageFlow {
  const sentiment = sentimentWord(stageSentiment(themes))
  if (themes.length === 0) return { sentiment, steps: [], next }
  const steps: FlowStep[] = [{ kind: 'Start', text: stageName, tone: 'neutral' }]
  for (const t of strongestFirst(themes).slice(0, 2)) {
    const kind = t.category === 'pain_point' ? 'Friction' : t.category === 'delight' ? 'Delight' : 'Expectation'
    steps.push({ kind, text: t.title, tone: kind === 'Friction' ? 'negative' : kind === 'Delight' ? 'positive' : 'neutral', note: `${t.participantCount} of ${t.totalParticipants} people` })
  }
  if (sentiment === 'Negative' || themes.some((t) => t.category === 'pain_point' && t.priority === 'high')) {
    steps.push({ kind: 'Decision', text: 'Keeps going?', tone: 'neutral', note: 'Risk of leaving here' })
  }
  return { sentiment, steps, next }
}
