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
