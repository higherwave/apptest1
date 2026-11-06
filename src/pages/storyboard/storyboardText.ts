export const SLIDE_TITLES = ['Title', 'The problem and what we did', 'What we heard', 'Recommended solutions', 'Trade-offs', 'Recommendation and the ask'] as const
export const SLIDE_COUNT = SLIDE_TITLES.length
/** Themes on the "What we heard" slide; the rest are behind "Show all themes". */
export const THEMES_ON_SLIDE = 5

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** 2026-11-12 (or a full timestamp) as "12 November 2026", read in UTC so the day does not move with the viewer's time zone. */
export function longDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** "15 September to 24 October 2026", sharing the year (and the month) when the two dates do. */
export function dateRange(from: string, to: string): string {
  if (from === to) return longDate(from)
  const a = longDate(from)
  const b = longDate(to)
  const [da, ma, ya] = a.split(' ')
  const [, mb, yb] = b.split(' ')
  if (ya !== yb) return `${a} to ${b}`
  return ma === mb ? `${da} to ${b}` : `${da} ${ma} to ${b}`
}

/** The title of the "What we heard" slide: the number of themes it shows and the people behind them. */
export const heardTitle = (themes: number, participants: number) => `${themes === 1 ? 'The strongest theme' : `The ${themes} strongest themes`} across ${plural(participants, 'participant')}`

/** A quote cut at a word to fit a tile, with an ellipsis when it was cut. */
export function clip(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const at = cut.lastIndexOf(' ')
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s.,;:!?-]+$/, '')}…`
}

/** What the label on the AI-written slides says, and whether this text came from a model. */
export const draftLabel = (source: 'model' | 'template') => (source === 'model' ? 'AI-suggested · a best guess' : 'Plain draft · made without the AI model')
