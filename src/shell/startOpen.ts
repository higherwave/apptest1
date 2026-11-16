/**
 * Which rows of an expandable list start open: none, unless there is only one row, which has nothing else to compete with (so it starts open).
 * Every expandable list in the app starts this way, so a long page opens as a short, scannable list.
 */
export const startOpen = (ids: string[]): Set<string> => (ids.length === 1 ? new Set(ids) : new Set<string>())
