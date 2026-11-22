// The steps of a launch and who covers each, shared by the server (which enforces it) and the Settings screens (which show it). Pure functions.
//
// An approver is set up once per step (Settings, Approvals): the workspace approver and an optional backup, and, for a team that needs someone else, a team
// approver (and backup) that replaces the workspace ones for that team. Stored as assignments: a person, a step, a team (null = the workspace) and a role
// ('primary' = approver, 'alternate' = backup). For one team and step:
//   - a team's own assignments beat the workspace's, but only when the team has an approver of its own (a team backup alone does not count);
//   - at the winning scope the approver is accountable and the backup answers only while the approver is away;
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

/** The assignments that decide for a team and step: the team's own when it has an approver of its own, else the workspace's. */
function poolFor(assignments, teamId, step) {
  const forStep = assignments.filter((a) => a.step === step)
  const own = forStep.filter((a) => a.teamId === teamId)
  return own.some((a) => a.role === 'primary') ? own : forStep.filter((a) => a.teamId == null)
}

/**
 * Who is active for a step right now, as user ids: the primaries who are available; if none is, the alternates who are; if nobody is, the primaries (someone
 * is still asked). `unavailable` on an assignment says its person is away. This is who gets the messages and the answer cards.
 */
export function activeFor(assignments, teamId, step) {
  const pool = poolFor(assignments, teamId, step)
  const primaries = pool.filter((a) => a.role === 'primary')
  const free = (list) => list.filter((a) => !a.unavailable).map((a) => a.userId)
  const p = free(primaries)
  if (p.length) return p
  const alts = free(pool.filter((a) => a.role === 'alternate'))
  return alts.length ? alts : primaries.map((a) => a.userId)
}

/**
 * Who covers a step for a team. `assignments` are { userId, step, teamId (null = all teams), role ('primary' | 'alternate') }.
 * Returns { scope: 'team' | 'all' | null, primary: [userId], alternate: [userId] }.
 */
export function reviewersFor(assignments, teamId, step) {
  const pool = poolFor(assignments, teamId, step)
  return {
    scope: pool.length ? (pool[0].teamId != null ? 'team' : 'all') : null,
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
