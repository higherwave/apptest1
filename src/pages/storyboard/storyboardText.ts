export type SlideKind = 'title' | 'problem' | 'heard' | 'solutions' | 'tradeoffs' | 'close'
/** One slide of the deck: what it is and, for the trade-offs, which solutions' rows it carries and which part of the table it is. */
export type SlideSpec = { kind: SlideKind; rows?: number[]; part?: number; parts?: number }

const KIND_TITLE: Record<SlideKind, string> = { title: 'Title', problem: 'The problem and what we did', heard: 'What we heard', solutions: 'Recommended solutions', tradeoffs: 'Trade-offs', close: 'Recommendation and the ask' }
export const slideTitle = (s: SlideSpec) => (s.kind === 'tradeoffs' && (s.part ?? 1) > 1 ? 'Trade-offs (continued)' : KIND_TITLE[s.kind])

// The trade-offs table gives each solution a row of five cells of up to 160 characters, so three long rows are taller than a slide. Rows are packed onto
// slides by an estimate of how tall each will be (the slide is a fixed size, so the estimate does not depend on the screen); a table that does not fit
// goes on to a "continued" slide with the header repeated, so no row is ever cut off.
const TABLE_ROOM_REM = 20.5 // what the rows may fill: the slide's height less its band, padding and the table's header row
const CELL_CHARS_PER_LINE = 15 // a cell is about 8rem of 12px text, which holds 17 to 20 characters of prose; counted lower so the estimate errs towards a new slide
const NAME_CHARS_PER_LINE = 16
const CELL_LINE_REM = 1.0125 // 12px at the meta role's 1.35 line height
const NAME_LINE_REM = 1.09 // 14px at 1.25
const ROW_PADDING_REM = 1.5

/** About how tall a solution's row is, in rem. */
export function rowHeight(s: { name: string; benefit: string; cost: string; risk: string; giveUp: string; alternatives: string }): number {
  const cells = Math.max(...[s.benefit, s.cost, s.risk, s.giveUp, s.alternatives].map((c) => Math.ceil(c.length / CELL_CHARS_PER_LINE)))
  const name = Math.ceil(s.name.length / NAME_CHARS_PER_LINE)
  return Math.max(cells * CELL_LINE_REM, name * NAME_LINE_REM) + ROW_PADDING_REM
}

/** Which solutions' rows go on which trade-offs slide, in order. A row that is taller than a slide still gets one to itself. */
export function paginateRows(solutions: Parameters<typeof rowHeight>[0][]): number[][] {
  const pages: number[][] = [[]]
  let used = 0
  solutions.forEach((s, i) => {
    const h = rowHeight(s)
    const page = pages[pages.length - 1]
    if (page.length > 0 && used + h > TABLE_ROOM_REM) {
      pages.push([i])
      used = h
    } else {
      page.push(i)
      used += h
    }
  })
  return pages
}

/** The slides of a deck in order: five fixed ones, with the trade-offs carried over onto further slides when its rows do not fit on one. */
export function slidePlan(solutions: Parameters<typeof rowHeight>[0][]): SlideSpec[] {
  const pages = paginateRows(solutions)
  return [
    { kind: 'title' },
    { kind: 'problem' },
    { kind: 'heard' },
    { kind: 'solutions' },
    ...pages.map((rows, i) => ({ kind: 'tradeoffs' as const, rows, part: i + 1, parts: pages.length })),
    { kind: 'close' },
  ]
}
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
