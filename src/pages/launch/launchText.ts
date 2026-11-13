// The words and tag colours the Launch screens use for a step's state. No React in here, so it is easy to test.
export type TagType = 'green' | 'teal' | 'red' | 'purple' | 'gray' | 'warm-gray' | 'outline'

export const STATE_LABEL: Record<string, string> = {
  preparing: 'Preparing',
  waiting: 'Waiting',
  missing: 'Approver missing',
  not_used: 'Not used',
  reopened: 'Reopened',
  ready: 'Ready',
  ready_with_conditions: 'Ready with conditions',
  changes_needed: 'Changes needed',
  not_applicable: 'Not applicable',
  go: 'Go',
  go_with_conditions: 'Go with conditions',
  no_go: 'No-go',
}
export const stateLabel = (state: string) => STATE_LABEL[state] ?? state

const TAG: Record<string, TagType> = {
  ready: 'green',
  go: 'green',
  ready_with_conditions: 'teal',
  go_with_conditions: 'teal',
  changes_needed: 'red',
  no_go: 'red',
  missing: 'red',
  reopened: 'purple',
  waiting: 'gray',
  preparing: 'gray',
  not_applicable: 'warm-gray',
  not_used: 'outline',
}
export const stateTag = (state: string): TagType => TAG[state] ?? 'gray'

/** "Dec 1, 2026" from "2026-12-01" (a day, not a moment, so no time zone moves it). */
export const dayText = (day: string | null) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : null)
/** "Dec 1, 2026, 3:04 PM" from a moment. */
export const momentText = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

/** Who can answer a step, in a line: "Alex Rivera, or Sam Lee as alternate". */
export function reviewersLine(primary: { name: string }[], alternate: { name: string }[]) {
  const p = primary.map((x) => x.name).join(' and ')
  const a = alternate.map((x) => x.name).join(' and ')
  if (!p && !a) return 'Nobody is set up yet'
  if (!p) return `Only an alternate: ${a}`
  return a ? `${p}, or ${a} as alternate` : p
}

export const KIND_LABEL: Record<string, string> = {
  team: 'You are on this team',
  leader: 'You see every team (read-only)',
  reviewer: 'You review steps of this launch',
  external: 'You review steps of this launch as an external reviewer',
  visitor: 'Read-only view',
}
