// Ordering on the Stories board. Cards in a column are ordered by a numeric position; a card dropped between two
// others takes the number halfway between them, so one move changes one row. The server and the page both use these
// functions, so the page can show a move at once and the server agrees with where it landed.

export const COLUMNS = ['todo', 'in_progress', 'in_review', 'done']
export const GAP = 1000
// Below this distance between neighbours the column is renumbered (1000, 2000, ...) before the card is placed.
export const MIN_DISTANCE = 0.001

const inColumn = (stories, movingId, status) => stories.filter((s) => s.status === status && s.id !== movingId).sort((a, b) => a.position - b.position)

// Where a card would sit if dropped into `status` just before the card `beforeId` (or at the end when beforeId is null).
// Returns { position, renumber }. `renumber` is true when the neighbours are too close to fit another card.
export function positionFor(stories, movingId, status, beforeId) {
  const column = inColumn(stories, movingId, status)
  const at = beforeId ? column.findIndex((s) => s.id === beforeId) : -1
  if (at < 0) return { position: column.length ? column[column.length - 1].position + GAP : GAP, renumber: false }
  const next = column[at].position
  const prev = at > 0 ? column[at - 1].position : 0
  return { position: (prev + next) / 2, renumber: next - prev < MIN_DISTANCE * 2 }
}

// Renumbers a column so its cards are 1000 apart, keeping their order. Returns [{ id, position }].
export function renumber(stories, movingId, status) {
  return inColumn(stories, movingId, status).map((s, i) => ({ id: s.id, position: (i + 1) * GAP }))
}

// The board after a move, as the page shows it before the server answers.
export function moved(stories, movingId, status, beforeId) {
  let list = stories
  let { position, renumber: needs } = positionFor(list, movingId, status, beforeId)
  if (needs) {
    const fresh = new Map(renumber(list, movingId, status).map((r) => [r.id, r.position]))
    list = list.map((s) => (fresh.has(s.id) ? { ...s, position: fresh.get(s.id) } : s))
    position = positionFor(list, movingId, status, beforeId).position
  }
  return list.map((s) => (s.id === movingId ? { ...s, status, position } : s))
}
