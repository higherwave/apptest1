export type LaunchStepKey = 'product_leadership' | 'sales' | 'legal' | 'documentation' | 'marketing' | 'final_decision'
export type ReviewerRole = 'primary' | 'alternate'
export type Assignment = { userId: string; step: string; teamId: string | null; role: ReviewerRole }
export const LAUNCH_STEPS: { key: LaunchStepKey; label: string; optional: boolean }[]
export function stepLabel(key: string): string
export function isStep(key: string): key is LaunchStepKey
export function isOptionalStep(key: string): boolean
export function reviewersFor(assignments: Assignment[], teamId: string, step: string): { scope: 'team' | 'all' | null; primary: string[]; alternate: string[] }
export function stepUsed(off: string[], step: string): boolean
export type CoverageState = 'covered' | 'gap' | 'not_used'
export function coverageState(assignments: Assignment[], off: string[], teamId: string, step: string): { state: CoverageState; scope: 'team' | 'all' | null; primary: string[]; alternate: string[] }
