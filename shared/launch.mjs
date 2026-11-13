// The steps of a launch and who covers each, shared by the server (which enforces it) and the Admin screens (which show it). Pure functions.
//
// A reviewer is set up once: a person, a step, the teams they cover (all teams, or one), and primary or alternate. For one team and step:
//   - an assignment for that team beats one for all teams (the narrowest scope wins);
//   - at the winning scope, the primaries are accountable and the alternates can answer in their place;
//   - a step the team does not use is "not used"; a step it uses that nobody covers is a "gap", never hidden.

/** The steps, in the order the Launch page shows them. The final decision is the one step every team uses. */
export const LAUNCH_STEPS = [
  { key: 'product_leadership', label: 'Product leadership', optional: true },
  { key: 'sales', label: 'Sales', optional: true },
  { key: 'legal', label: 'Legal', optional: true },
  { key: 'documentation', label: 'Documentation', optional: true },
  { key: 'marketing', label: 'Marketing', optional: true },
  { key: 'final_decision', label: 'Final decision', optional: false },
]

export const stepLabel = (key) => LAUNCH_STEPS.find((s) => s.key === key)?.label ?? key
export const isStep = (key) => LAUNCH_STEPS.some((s) => s.key === key)
/** The steps a team may turn off (every step but the final decision). */
export const isOptionalStep = (key) => LAUNCH_STEPS.some((s) => s.key === key && s.optional)

/**
 * Who covers a step for a team. `assignments` are { userId, step, teamId (null = all teams), role ('primary' | 'alternate') }.
 * Returns { scope: 'team' | 'all' | null, primary: [userId], alternate: [userId] }.
 */
export function reviewersFor(assignments, teamId, step) {
  const forStep = assignments.filter((a) => a.step === step)
  const own = forStep.filter((a) => a.teamId === teamId)
  const pool = own.length ? own : forStep.filter((a) => a.teamId == null)
  return {
    scope: pool.length ? (own.length ? 'team' : 'all') : null,
    primary: pool.filter((a) => a.role === 'primary').map((a) => a.userId),
    alternate: pool.filter((a) => a.role === 'alternate').map((a) => a.userId),
  }
}

/** Whether a team's launches use a step. `off` is the set of steps the team turned off. The final decision is always used. */
export const stepUsed = (off, step) => !isOptionalStep(step) || !off.includes(step)

/**
 * The state of one cell of the coverage grid:
 *   'not_used' the team does not use the step; 'gap' it does, and nobody covers it as a primary (an alternate alone is still a gap);
 *   'covered' at least one primary.
 */
export function coverageState(assignments, off, teamId, step) {
  if (!stepUsed(off, step)) return { state: 'not_used', ...reviewersFor(assignments, teamId, step) }
  const who = reviewersFor(assignments, teamId, step)
  return { state: who.primary.length ? 'covered' : 'gap', ...who }
}

// Answers --------------------------------------------------------------------------------------------------------------------------------------

/** What a step's reviewer can answer, and what the final decision can be. `good` means it does not hold the launch back. */
export const STEP_ANSWERS = [
  { key: 'ready', label: 'Ready', good: true },
  { key: 'ready_with_conditions', label: 'Ready with conditions', good: true },
  { key: 'changes_needed', label: 'Changes needed', good: false },
  { key: 'not_applicable', label: 'Not applicable', good: true },
]
export const FINAL_ANSWERS = [
  { key: 'go', label: 'Go', good: true },
  { key: 'go_with_conditions', label: 'Go with conditions', good: true },
  { key: 'no_go', label: 'No-go', good: false },
]
export const answersFor = (step) => (step === 'final_decision' ? FINAL_ANSWERS : STEP_ANSWERS)
export const isAnswerFor = (step, answer) => answersFor(step).some((a) => a.key === answer)
export const answerLabel = (answer) => [...STEP_ANSWERS, ...FINAL_ANSWERS].find((a) => a.key === answer)?.label ?? answer
/** A plain "ready" or "go" needs no explanation; every other answer says why. */
export const rationaleRequired = (answer) => answer !== 'ready' && answer !== 'go'

/**
 * The state of one step of a launch, for the summary. `answer` is the current (latest) answer or null; `reopened` says the brief changed since it was
 * given. A step the team does not use is 'not_used'; one it uses that has no primary reviewer is 'missing' (an answer already given still shows).
 */
export function stepState({ used, hasPrimary, answer, reopened }) {
  if (!used) return 'not_used'
  if (answer && reopened) return 'reopened'
  if (answer) return answer
  return hasPrimary ? 'waiting' : 'missing'
}
