// Grouping and ranking for Pulse topics. Pure functions, no database: the same code runs in the tests, the hourly job and the screens' numbers.
//
// The grouping here is the SIMULATED one, deterministic so a demo shows the same topics every time. A signal first goes to the common customer-feedback concept it
// matches most words of (trust, handoffs, reporting...); signals that match none are put together by the salient words they share (not everyday words, not words in nearly
// every signal), weighted by how rare the word is. When the model is switched on, a provider-seam version replaces `groupSignals` and keeps the
// same shape: topics are only ever sets of signal ids, and every count and score below is computed from those ids, never written by a model.

export const CHANNELS = ['slack', 'call_notes', 'support_tickets', 'conference', 'other'] as const
export type Channel = (typeof CHANNELS)[number]
export const CHANNEL_LABEL: Record<Channel, string> = { slack: 'Slack', call_notes: 'Call notes', support_tickets: 'Support tickets', conference: 'Conference', other: 'Other' }
/** What a signal from each channel counts for, until an owner changes it. Direct customer words weigh most. */
export const DEFAULT_WEIGHTS: Record<Channel, number> = { call_notes: 1, support_tickets: 0.8, conference: 0.6, slack: 0.5, other: 0.3 }
export const isChannel = (c: string): c is Channel => (CHANNELS as readonly string[]).includes(c)

export type GroupInput = { id: string; body: string }
export type Group = { title: string; ids: string[] }

const STOP = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers him his how i if in into is it its just like me more most my no nor not now of off on once only or other our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your
   get got make made want need needs wanted say said says tell told every still even much many really thing things one two three way ever back take takes lot actually kind sort bit new old good great bad first last next week weeks month months day days time times today yesterday end start`.split(/\s+/),
)

/** Lowercase words with a light stem, everyday words dropped. */
export function terms(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOP.has(raw) || /^\d+$/.test(raw)) continue
    out.push(stem(raw))
  }
  return out
}

function stem(w: string): string {
  if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3)
  if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2)
  if (w.length > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y'
  if (w.length > 4 && w.endsWith('es') && /(ch|sh|ss|x)es$/.test(w)) return w.slice(0, -2)
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1)
  return w
}

type Vec = Map<string, number>
const dot = (a: Vec, b: Vec) => {
  let s = 0
  const [small, big] = a.size < b.size ? [a, b] : [b, a]
  for (const [k, v] of small) s += v * (big.get(k) ?? 0)
  return s
}
const norm = (a: Vec) => Math.sqrt(dot(a, a))

export const MIN_SIMILARITY = 0.3
export const MIN_TOPIC_SIGNALS = 2

/** The simulated provider's concepts: a working title and the words that point to it. Order breaks ties. */
const CONCEPTS: { title: string; words: string }[] = [
  { title: 'Trust and accuracy', words: 'trust accurate accuracy wrong reliable score health explain explanation factor confidence believe amber green red dropped' },
  { title: 'Handoffs and lost context', words: 'handoff hand handed history context queue escalate escalation transfer redo investigation teams ticket' },
  { title: 'Reporting and digests', words: 'report reporting digest dashboard board slide export spreadsheet summary weekly monthly portfolio rebuild' },
  { title: 'Renewal preparation', words: 'renewal renew playbook prep prepare preparing tabs checklist enterprise mid-market' },
  { title: 'Onboarding and setup', words: 'onboarding onboard setup provision admins rollout region install' },
  { title: 'Pricing and cost', words: 'price pricing cost tier fee invoice budget expensive quote' },
  { title: 'Integrations', words: 'integration connector api sync salesforce servicenow import webhook' },
  { title: 'Speed and reliability', words: 'slow speed lag crash outage timeout loading latency' },
  { title: 'Access and permissions', words: 'permission role sso login access password admin' },
  { title: 'Alerts and notifications', words: 'alert notification notify reminder email digest ping' },
].map((c) => ({ ...c, words: [...new Set(c.words.split(/\s+/).map((w) => stem(w)))].join(' ') }))

/**
 * Puts signals into groups by the words they share. A group needs at least two signals; a signal that fits nowhere is left out (it stays unsorted). Average-link
 * merging on rare-word weights, most similar pair first, stopping when nothing is similar enough. Same input, same output.
 */
export function groupSignals(signals: GroupInput[]): Group[] {
  const named = groupByConcept(signals)
  const taken = new Set(named.flatMap((g) => g.ids))
  const rest = groupBySharedWords(signals.filter((s) => !taken.has(s.id)))
  return [...named, ...rest].sort((a, b) => b.ids.length - a.ids.length || a.title.localeCompare(b.title))
}

/** Each signal goes to the concept it matches most words of (the first, on a tie); a concept with fewer than two signals is dropped and its signal falls through. */
function groupByConcept(signals: GroupInput[]): Group[] {
  const by = new Map<string, string[]>()
  for (const s of signals) {
    const mine = new Set(terms(s.body))
    let best: string | null = null
    let bestHits = 0
    for (const c of CONCEPTS) {
      const hits = c.words.split(' ').filter((w) => mine.has(w)).length
      if (hits > bestHits) { best = c.title; bestHits = hits }
    }
    if (best) by.set(best, [...(by.get(best) ?? []), s.id])
  }
  return [...by.entries()].filter(([, ids]) => ids.length >= MIN_TOPIC_SIGNALS).map(([title, ids]) => ({ title, ids }))
}

function groupBySharedWords(signals: GroupInput[]): Group[] {
  const n = signals.length
  if (n < MIN_TOPIC_SIGNALS) return []
  const words = signals.map((s) => new Set(terms(s.body)))
  const df = new Map<string, number>()
  for (const set of words) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1)
  // Salient: in at least two signals, but not in more than half of them.
  const maxDf = Math.max(3, Math.floor(n / 2))
  const idf = (w: string) => Math.log(1 + n / (df.get(w) ?? 1))
  const vecs: Vec[] = words.map((set) => new Map([...set].filter((w) => (df.get(w) ?? 0) >= 2 && (df.get(w) ?? 0) <= maxDf).map((w) => [w, idf(w)])))

  type Cluster = { ids: number[]; vec: Vec }
  let clusters: Cluster[] = vecs.map((v, i) => ({ ids: [i], vec: new Map(v) }))
  const sim = (a: Cluster, b: Cluster) => {
    const d = norm(a.vec) * norm(b.vec)
    return d === 0 ? 0 : dot(a.vec, b.vec) / d
  }
  for (;;) {
    let best = -1
    let bi = -1
    let bj = -1
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const s = sim(clusters[i], clusters[j])
        if (s > best + 1e-12) { best = s; bi = i; bj = j }
      }
    }
    if (best < MIN_SIMILARITY) break
    const merged: Cluster = { ids: [...clusters[bi].ids, ...clusters[bj].ids], vec: new Map(clusters[bi].vec) }
    for (const [k, v] of clusters[bj].vec) merged.vec.set(k, (merged.vec.get(k) ?? 0) + v)
    clusters = clusters.filter((_, k) => k !== bi && k !== bj)
    clusters.push(merged)
  }
  return clusters
    .filter((c) => c.ids.length >= MIN_TOPIC_SIGNALS)
    .map((c) => ({ title: titleFor(c.ids.map((i) => signals[i].body), c.vec), ids: c.ids.map((i) => signals[i].id) }))
}

/** A short working title from the cluster's strongest shared words, in the form people wrote them. People rename it. */
function titleFor(bodies: string[], vec: Vec): string {
  const top = [...vec.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([w]) => w)
  const form = new Map<string, number>()
  for (const b of bodies) for (const raw of b.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/)) if (top.includes(stem(raw))) form.set(raw, (form.get(raw) ?? 0) + 1)
  const shown = top.map((w) => [...form.entries()].filter(([raw]) => stem(raw) === w).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? w)
  const text = shown.join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** The topic (by id) a new signal fits best among existing ones, or null. Used by the hourly job so a new signal joins a topic without regrouping the rest. */
export function bestTopic(body: string, topics: { id: string; bodies: string[] }[]): string | null {
  const mine = new Set(terms(body))
  let best: string | null = null
  let bestScore = 0
  for (const t of topics) {
    const df = new Map<string, number>()
    for (const b of t.bodies) for (const w of new Set(terms(b))) df.set(w, (df.get(w) ?? 0) + 1)
    // Words shared with at least two of the topic's signals, scaled by how many of its signals use them.
    let score = 0
    let shared = 0
    for (const [w, c] of df) if (mine.has(w) && c >= 2) { score += c / t.bodies.length; shared++ }
    if (shared >= 1 && score > bestScore + 1e-9) { best = t.id; bestScore = score }
  }
  return bestScore >= 0.4 ? best : null
}

// Ranking ----------------------------------------------------------------------------------------------------------------------

export type RankSignal = { channel: Channel; account: string | null; saidBy: string | null; occurredOn: string | null; createdAt: string }
export type Breakdown = { channel: Channel; count: number; weight: number; subtotal: number }
export type TopicStats = {
  signals: number
  channels: Partial<Record<Channel, number>>
  channelCount: number
  /** Distinct accounts (or, where none is named, people) behind the signals. */
  reach: number
  score: number
  breakdown: Breakdown[]
  trend: 'new' | 'rising' | 'steady' | 'fading'
}

const round2 = (n: number) => Math.round(n * 100) / 100
const clean = (s: string | null) => (s && s.trim() && !/^unknown$/i.test(s.trim()) ? s.trim().toLowerCase() : null)

/** Every number a topic shows, from its kept signals and the channel weights. The score is the weighted sum of signals per channel, and `breakdown` is that sum in full. */
export function topicStats(signals: RankSignal[], weights: Record<Channel, number>, today: Date = new Date()): TopicStats {
  const channels: Partial<Record<Channel, number>> = {}
  for (const s of signals) channels[s.channel] = (channels[s.channel] ?? 0) + 1
  const breakdown = CHANNELS.filter((c) => channels[c]).map((c) => ({ channel: c, count: channels[c]!, weight: weights[c], subtotal: round2(channels[c]! * weights[c]) }))
  const who = new Set<string>()
  for (const s of signals) {
    const k = clean(s.account) ?? (clean(s.saidBy) ? `person:${clean(s.saidBy)}` : null)
    if (k) who.add(k)
  }
  const day = 86_400_000
  const when = (s: RankSignal) => Date.parse(s.occurredOn ?? s.createdAt)
  const recent = signals.filter((s) => today.getTime() - when(s) <= 14 * day).length
  const before = signals.filter((s) => today.getTime() - when(s) > 14 * day && today.getTime() - when(s) <= 28 * day).length
  const older = signals.length - recent - before
  const trend: TopicStats['trend'] = older === 0 && before === 0 && recent > 0 ? 'new' : recent > before ? 'rising' : recent < before ? 'fading' : 'steady'
  return { signals: signals.length, channels, channelCount: Object.keys(channels).length, reach: who.size, score: round2(breakdown.reduce((a, b) => a + b.subtotal, 0)), breakdown, trend }
}

// Questions ---------------------------------------------------------------------------------------------------------------------

export type QuoteInput = { id: string; body: string; saidBy: string | null; channel: Channel; at: string }
export type Suggested = { topicId: string; topicTitle: string; prompt: string; evidence: { signalId: string; quote: string; saidBy: string | null; channel: Channel } | null }

// The simulated provider's wording, by research method: two open questions each. A model replaces this behind the same shape; the evidence stays a verbatim signal.
const ASK: Record<string, [(t: string) => string, (t: string) => string]> = {
  'Contextual (walk-through)': [(t) => `Walk me through the last time ${t} came up for you.`, () => 'What did you do next, and what got in your way?'],
  'User Discussions': [(t) => `How does ${t} show up in your week?`, (t) => `If ${t} were fixed tomorrow, what would change for you?`],
  'Usability Test': [(t) => `Show me how you handle ${t} today. Where do you hesitate?`, () => 'What did you expect to happen next?'],
  'Support or CSM channels': [(t) => `What do you hear from customers about ${t}?`, () => 'Where does that conversation get stuck?'],
  Survey: [(t) => `How often does ${t} get in the way of your work? (1 to 5)`, (t) => `How important is it to improve ${t}? (1 to 5)`],
}
export const FALLBACK_METHOD = 'User Discussions'
/** About one session's worth of questions. */
export const MAX_QUESTIONS = 6

const phrase = (title: string) => title.charAt(0).toLowerCase() + title.slice(1)

/**
 * Questions for a research session on these topics, grouped under their topic and each with the evidence that prompted it. One open question per topic first, then a question
 * built on the strongest customer quote of each topic ("a customer told us: ..."), then the follow-up questions, never more than MAX_QUESTIONS. The quote is the signal's own words.
 */
export function suggestQuestions(topics: { id: string; title: string; quotes: QuoteInput[] }[], method: string, weights: Record<Channel, number> = DEFAULT_WEIGHTS): Suggested[] {
  const [open, follow] = ASK[method] ?? ASK[FALLBACK_METHOD]
  const best = (t: { quotes: QuoteInput[] }) => [...t.quotes].sort((a, b) => weights[b.channel] - weights[a.channel] || b.at.localeCompare(a.at) || a.id.localeCompare(b.id))[0]
  const ev = (q: QuoteInput | undefined) => (q ? { signalId: q.id, quote: q.body, saidBy: q.saidBy, channel: q.channel } : null)
  const out: Suggested[] = []
  for (const t of topics) out.push({ topicId: t.id, topicTitle: t.title, prompt: open(phrase(t.title)), evidence: ev(best(t)) })
  for (const t of topics) {
    const q = best(t)
    if (q) out.push({ topicId: t.id, topicTitle: t.title, prompt: `A customer told us: “${q.body.length > 220 ? q.body.slice(0, 217).trimEnd() + '…' : q.body}” What was behind that for you?`, evidence: ev(q) })
  }
  for (const t of topics) out.push({ topicId: t.id, topicTitle: t.title, prompt: follow(phrase(t.title)), evidence: null })
  return out.slice(0, MAX_QUESTIONS)
}
