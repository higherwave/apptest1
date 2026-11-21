// Pulse's rudimentary cleaning (decided 2026-11-21: early discovery is better with less, higher-quality information than with every nuance). Before a new signal is saved it is compared with
// the ones already there; a near-copy is left out, so the same complaint pasted twice, a notes import repeated, or a Slack message quoted in a call note does not count twice. The comparison
// is by the words that matter (the same `terms` the topics use), ready to be replaced by the AI provider seam. A signal a person typed in is never second-guessed, and a dismissed signal still
// counts as seen, so something a person threw away does not come back.
import type { Queryable } from './db.js'
import { terms } from './pulse-topics.js'

const SAME = 0.8
const MIN_WORDS = 4
const LOOK_BACK = 2000

export type Seen = Set<string>[]

/** The words of the workspace's latest signals, of any status. */
export async function loadSeen(db: Queryable, workspaceId: string): Promise<Seen> {
  const rows = (await db.query(`select body from core.pulse_signals where workspace_id = $1 order by created_at desc limit ${LOOK_BACK}`, [workspaceId])).rows as { body: string }[]
  return rows.map((r) => new Set(terms(r.body)))
}

const similarity = (a: Set<string>, b: Set<string>) => {
  let both = 0
  for (const w of a) if (b.has(w)) both++
  return both / (a.size + b.size - both)
}

/** True when the text is a near-copy of a signal already seen (and so should be left out). Otherwise it is remembered, so a repeat inside the same batch is caught too. */
export function isRepeat(body: string, seen: Seen): boolean {
  const words = new Set(terms(body))
  if (words.size < MIN_WORDS) return false
  for (const other of seen) if (other.size >= MIN_WORDS && similarity(words, other) >= SAME) return true
  seen.push(words)
  return false
}

/** The channel's own ids of messages already saved, so reading the same message again is quietly nothing (not a "repeat"). */
export async function loadKnownIds(db: Queryable, workspaceId: string, source: string): Promise<Set<string>> {
  return new Set(((await db.query(`select external_id from core.pulse_signals where workspace_id = $1 and source = $2 and external_id is not null`, [workspaceId, source])).rows as { external_id: string }[]).map((r) => r.external_id))
}
