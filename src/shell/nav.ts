// The nine project steps in order, grouped as in the prototype's side menu. (Measure is a place of its own, across projects.)
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
]

export const INSIGHT_SECTIONS = [
  { key: 'themes', label: 'Platform Themes' },
  { key: 'personas', label: 'Personas' },
  { key: 'journey', label: 'Journeys' },
  { key: 'case-studies', label: 'Case studies' },
]

// The Admin tab (its pages live under /settings/<key>): Experience Categories and Notifications for owners and editors; AI usage and costs, System usage, Teams, Members and the Audit log are for owners (SettingsHeader hides the ones a person cannot use).
export const SETTINGS_SECTIONS = [
  { key: 'categories', label: 'Experience Categories' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'status', label: 'AI usage and costs' },
  { key: 'usage', label: 'System usage' },
  { key: 'teams', label: 'Teams' },
  { key: 'members', label: 'Members' },
  { key: 'audit', label: 'Audit log' },
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
