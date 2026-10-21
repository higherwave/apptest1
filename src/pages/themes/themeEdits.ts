import type { Theme, ThemeCategory, ThemePatch } from '../../api/client'

// Pure rules for editing a theme, shared by the three screens. The API is the authority; these make the page
// respond at once and then settle with what the server returns.

export type Level = 'low' | 'medium' | 'high'
export const LEVELS: Level[] = ['low', 'medium', 'high']
export const LEVEL_LABEL: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High' }
// Importance runs 1 (low) to 3 (high) on the matrix; effort runs 1 (low) to 3 (high).
export const importanceOf = (level: Level) => LEVELS.indexOf(level) + 1
export const levelOf = (importance: number): Level => LEVELS[importance - 1]
export const EFFORT_LABEL: Record<number, string> = { 1: 'Low', 2: 'Medium', 3: 'High' }

export const CATEGORY_LABEL: Record<ThemeCategory, string> = { pain_point: 'Pain point', need: 'Need', expectation: 'Expectation', delight: 'Delight' }
export const CATEGORIES: ThemeCategory[] = ['pain_point', 'need', 'expectation', 'delight']

export const ZONES: Record<string, string> = { '3-1': 'Quick wins', '3-3': 'Major projects', '1-1': 'Fill-ins', '1-3': 'Reconsider' }

// What the theme looks like after a patch, mirroring the server: a key left out is untouched, null goes back to the
// suggestion, and a blank title goes back to the analysis's.
export function applyPatch(theme: Theme, patch: ThemePatch): Theme {
  const next = { ...theme }
  if (patch.title !== undefined) next.title = patch.title && patch.title.trim() ? patch.title.trim() : theme.originalTitle
  if (patch.stagePosition !== undefined) next.stagePosition = patch.stagePosition ?? theme.suggestedStagePosition
  if (patch.priority !== undefined) next.priority = patch.priority ?? theme.suggestedPriority
  if (patch.effort !== undefined) next.effort = patch.effort ?? theme.suggestedEffort
  next.edited = next.priority !== next.suggestedPriority || next.effort !== next.suggestedEffort
  return next
}

// Moving a theme on the matrix. A value equal to the suggestion is sent as null, so the theme does not carry a
// pointless edit and "Reset" has nothing to undo.
export function matrixPatch(theme: Theme, importance: number, effort: number): ThemePatch {
  const level = levelOf(importance)
  return { priority: level === theme.suggestedPriority ? null : level, effort: effort === theme.suggestedEffort ? null : effort }
}

export const cellKey = (theme: Pick<Theme, 'priority' | 'effort'>) => `${importanceOf(theme.priority as Level)}-${theme.effort}`
export const participantsLabel = (t: Pick<Theme, 'participantCount' | 'totalParticipants'>) => `${t.participantCount} of ${t.totalParticipants} participants`
