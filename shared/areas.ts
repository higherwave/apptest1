// Experience categories: the words that decide whether two names are the same area, and which area a piece of text is about. Plain functions,
// no database and no model, shared by the API (the duplicate check) and the screens (the suggestion beside a question), so both agree.
export type AreaLike = { id: string; name: string; definition?: string | null; aliases?: string[] }

const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'for', 'and', 'or', 'in', 'on', 'with', 'by', 'your', 'you', 'is', 'it', 'this', 'that', 'what', 'how', 'do', 'does', 'can', 'will', 'would', 'about', 'when', 'where', 'which', 'user', 'users', 'feature', 'page', 'screen', 'flow'])
const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ions', 'ion', 'ers', 'er', 'ed', 'es', 's', 'e']

/** A rough stem, enough that Scheduling, Reschedule and Schedules meet: lower case, a leading "re" and a common ending removed. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (w.length > 6 && w.startsWith('re')) w = w.slice(2)
  for (const s of SUFFIXES) {
    if (w.length - s.length >= 4 && w.endsWith(s)) {
      w = w.slice(0, -s.length)
      break
    }
  }
  return w
}

export const tokens = (text: string): string[] => [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1 && !STOP.has(w)).map(stem).filter(Boolean))]
const same = (a: string, b: string) => tokens(a).sort().join(' ') === tokens(b).sort().join(' ') && tokens(a).length > 0

export type SimilarArea = { area: AreaLike; reason: 'same-name' | 'alias' | 'similar'; score: number }

/**
 * The existing areas a new name could be a duplicate of. Same words (in any order, any common ending) is a duplicate; an alias hit is a
 * duplicate; sharing most of the words, or one name's words being inside the other's, is similar. Best first.
 */
export function similarAreas(name: string, areas: AreaLike[]): SimilarArea[] {
  const mine = tokens(name)
  const out: SimilarArea[] = []
  for (const area of areas) {
    if (same(name, area.name)) out.push({ area, reason: 'same-name', score: 1 })
    else if ((area.aliases ?? []).some((a) => same(name, a))) out.push({ area, reason: 'alias', score: 0.95 })
    else {
      const theirs = tokens(area.name)
      if (!mine.length || !theirs.length) continue
      const shared = mine.filter((w) => theirs.includes(w)).length
      const inside = shared === Math.min(mine.length, theirs.length) && shared > 0
      const jaccard = shared / new Set([...mine, ...theirs]).size
      if (inside || jaccard >= 0.5) out.push({ area, reason: 'similar', score: Math.max(jaccard, inside ? 0.7 : 0) })
    }
  }
  return out.sort((a, b) => b.score - a.score)
}

export type AreaSuggestion = { area: AreaLike; score: number }

/**
 * Which areas a question or task is about, best first, by the words it shares with each area's name, aliases and definition. Names and
 * aliases count most. Returns at most three, and only those with real overlap, so a question about nothing known gets no suggestion.
 */
export function suggestAreas(text: string, areas: AreaLike[]): AreaSuggestion[] {
  const words = new Set(tokens(text))
  if (!words.size) return []
  const out: AreaSuggestion[] = []
  for (const area of areas) {
    const strong = new Set([...tokens(area.name), ...(area.aliases ?? []).flatMap(tokens)])
    const weak = new Set(tokens(area.definition ?? ''))
    const strongHits = [...strong].filter((w) => words.has(w)).length
    const weakHits = [...weak].filter((w) => !strong.has(w) && words.has(w)).length
    const score = strongHits * 2 + weakHits * 0.5
    if (strongHits >= 1 || weakHits >= 2) out.push({ area, score })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 3)
}
