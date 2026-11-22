import { T } from '../../shared/terms.mjs'
// The ten project steps in order, grouped as in the prototype's side menu. (Measure is a place of its own, across projects.)
export const STEP_GROUPS = ['Discovery', 'Analysis', 'Strategy', 'Delivery'] as const
export type StepGroup = (typeof STEP_GROUPS)[number]

export const STEPS: { key: string; label: string; group: StepGroup }[] = [
  { key: 'plan', label: 'Test Plan', group: 'Discovery' },
  { key: 'participants', label: 'Participants', group: 'Discovery' },
  { key: 'transcripts', label: 'Transcripts', group: 'Discovery' },
  { key: 'themes', label: 'Themes', group: 'Analysis' },
  { key: 'storyboard', label: 'Storyboard', group: 'Analysis' },
  { key: 'prio', label: 'Priorities', group: 'Strategy' },
  { key: 'requirements', label: 'Requirements', group: 'Strategy' },
  { key: 'design', label: 'Design', group: 'Strategy' },
  { key: 'stories', label: 'Stories', group: 'Delivery' },
  { key: 'launch', label: 'Launch', group: 'Delivery' },
]

export const INSIGHT_SECTIONS = [
  { key: 'themes', label: 'Platform Themes' },
  { key: 'personas', label: 'Personas' },
  { key: 'journey', label: 'Journeys' },
  { key: 'case-studies', label: 'Case studies' },
]

// The Settings tab (its pages live under /settings/<key>): Experience Categories and Notifications for owners and editors; Usage and Costs, User Access, Data and the Audit log are for owners (SettingsHeader hides the ones a person cannot use).
export const SETTINGS_SECTIONS = [
  { key: 'categories', label: 'Experience Categories' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'usage', label: 'Usage and Costs' },
  { key: 'access', label: 'User Access' },
  { key: 'data', label: 'Data' },
  { key: 'audit', label: 'Audit log' },
  { key: 'pulse', label: 'Pulse' },
  { key: 'preview', label: 'Previews' },
]

// The Settings menu (the horizontal one under the title bar, like a project's): groups of views. Each view is a section's page (/settings/<section>), and where a section has views of its own the
// choice is in the address (?tab=...), the first being the default. A group is for owners only where `ownerOnly` says so (editors see Experience Categories and Communication), and the Pulse group
// shows only while the Pulse preview is on. The terms for the sign-off roles come from shared/terms.mjs.
export type AdminItem = { key: string; label: string; section: string; tab?: string; testId?: string }
export type AdminGroup = { label: string; items: AdminItem[]; ownerOnly?: boolean; needsPulse?: boolean }
export const ADMIN_GROUPS: AdminGroup[] = [
  { label: 'Experience Categories', items: [{ key: 'categories', label: 'Categories', section: 'categories', tab: 'current', testId: 'tab-current' }, { key: 'matches', label: 'Matches', section: 'categories', tab: 'matches', testId: 'tab-matches' }] },
  { label: 'Usage and Costs', ownerOnly: true, items: [{ key: 'ai', label: 'AI', section: 'usage', tab: 'ai', testId: 'tab-ai' }, { key: 'system', label: 'System', section: 'usage', tab: 'system', testId: 'tab-system' }] },
  { label: 'Communication', items: [{ key: 'notifications', label: 'Notifications', section: 'notifications' }] },
  { label: 'User Access', ownerOnly: true, items: [{ key: 'people', label: 'People', section: 'access', tab: 'people', testId: 'tab-people' }, { key: 'teams', label: 'Teams', section: 'access', tab: 'teams', testId: 'tab-teams' }, { key: 'approvals', label: T.Approvals, section: 'access', tab: 'approvals', testId: 'tab-approvals' }] },
  { label: 'Data and Compliance', ownerOnly: true, items: [{ key: 'data', label: 'Data', section: 'data' }, { key: 'audit', label: 'Audit log', section: 'audit' }] },
  { label: 'Pulse', ownerOnly: true, needsPulse: true, items: [{ key: 'pulse', label: 'Pulse', section: 'pulse' }] },
  { label: 'Previews', ownerOnly: true, items: [{ key: 'preview', label: 'Previews', section: 'preview' }] },
]

export const SECTION_TITLES: Record<string, string> = Object.fromEntries([
  ...STEPS.map((s) => [s.key, s.label]),
  ...INSIGHT_SECTIONS.map((s) => [s.key, s.label]),
  ...SETTINGS_SECTIONS.map((s) => [s.key, s.label]),
])

// One line under each step's name in the project's step rail.
export const STEP_NOTES: Record<string, string> = {
  plan: 'What to test, what to ask',
  participants: 'Who you will speak with',
  transcripts: 'Meeting transcripts',
  themes: 'AI-generated themes',
  storyboard: 'Team communications',
  prio: 'Impact vs effort',
  requirements: 'AI-assisted docs',
  design: 'Designs by Requirement',
  stories: 'Jira-ready tickets',
  launch: 'The go signals',
}

export type StepState = 'done' | 'current' | 'ready' | 'locked'

/**
 * How each step reads in the rail, from which of them are open (the server says; steps open in order, with Priorities after Themes).
 * While any step is locked the project is being set up ("guided"): the steps before the one to work on are done, that one is current,
 * any other open step is ready and the rest are locked. Once every step is open the rail is neutral ("after"): they all read as done.
 */
export function stepStates(open: boolean[]): { mode: 'guided' | 'after'; states: StepState[] } {
  const firstLocked = open.indexOf(false)
  if (firstLocked === -1) return { mode: 'after', states: open.map(() => 'done') }
  const current = Math.max(0, firstLocked - 1)
  return { mode: 'guided', states: open.map((o, i) => (!o ? 'locked' : i < current ? 'done' : i === current ? 'current' : 'ready')) }
}
