import { LAUNCH_STEPS } from '../../../shared/launch.mjs'

/** A step's name by its key. */
export const STEP_LABELS: Record<string, string> = Object.fromEntries(LAUNCH_STEPS.map((s) => [s.key, s.label]))
