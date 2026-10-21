// Types for shared/providers.mjs, which is plain JavaScript so that both the API and the seed script can run it.

export type ParsedLine = { who: string; text: string; ts: string; mod: boolean }
export function parseTranscript(text: string): ParsedLine[]
export function scoreTheme(input: { ppl: number; total: number; mentions: number; sev: number }): { score: number; prio: 'High' | 'Medium' | 'Low' }

export type ThemeDef = { id: string; title: string; cat: 'Pain point' | 'Need' | 'Expectation' | 'Delight'; stage: number; sev: number; kw: string[]; desc: string; opp: string }
export type AnalyzedQuote = { t: number; u: number; who: string; pid: string; text: string; ts: string }
export type AnalyzedTheme = ThemeDef & {
  quotes: AnalyzedQuote[]
  ppl: number
  total: number
  mentions: number
  score: number
  prio: 'High' | 'Medium' | 'Low'
  eff: number
  effNote: string
}
export function analyze(
  transcripts: { name: string; text: string }[],
  participants: { name: string }[],
  defs: ThemeDef[],
  eff: Record<string, [number, string]>,
): AnalyzedTheme[]

export function buildSteps(ctx: unknown, inc: Record<string, boolean>): unknown[]
export function matchThemes(
  themes: { id: string; title: string; description?: string; opportunity?: string }[],
  platformThemes: { id: string; keywords: string[] }[],
): { themeId: string; platformThemeId: string; confidence: number }[]
export const MIN_HITS: number
