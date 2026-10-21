export const COLUMNS: readonly ['todo', 'in_progress', 'in_review', 'done']
export type ColumnStatus = (typeof COLUMNS)[number]
export const GAP: number
export const MIN_DISTANCE: number
type Positioned = { id: string; status: string; position: number }
export function positionFor(stories: Positioned[], movingId: string, status: string, beforeId: string | null): { position: number; renumber: boolean }
export function renumber(stories: Positioned[], movingId: string, status: string): { id: string; position: number }[]
export function moved<T extends Positioned>(stories: T[], movingId: string, status: string, beforeId: string | null): T[]
