// The ten project steps in order, grouped as in the prototype's side menu.
export const STEP_GROUPS = ['Discovery', 'Analysis', 'Strategy', 'Delivery'] as const
export type StepGroup = (typeof STEP_GROUPS)[number]

export const STEPS: { key: string; label: string; group: StepGroup }[] = [
  { key: 'plan', label: 'Test Plan', group: 'Discovery' },
  { key: 'tasks', label: 'Task List', group: 'Discovery' },
  { key: 'transcripts', label: 'Transcripts', group: 'Discovery' },
  { key: 'themes', label: 'Themes', group: 'Analysis' },
  { key: 'journey', label: 'Journey Map', group: 'Analysis' },
  { key: 'prio', label: 'Priorities', group: 'Strategy' },
  { key: 'requirements', label: 'Requirements', group: 'Strategy' },
  { key: 'design', label: 'Design', group: 'Strategy' },
  { key: 'stories', label: 'Stories', group: 'Delivery' },
  { key: 'measure', label: 'Measure', group: 'Delivery' },
]

export const INSIGHT_SECTIONS = [
  { key: 'themes', label: 'Platform Themes' },
  { key: 'personas', label: 'Personas' },
  { key: 'journey', label: 'Journey' },
  { key: 'case-studies', label: 'Case studies' },
]

// The Admin tab (its pages live under /settings/<key>): Experience Categories for owners and editors; App Status, Members and the Audit log are for owners (SettingsHeader hides the ones a person cannot use).
export const SETTINGS_SECTIONS = [
  { key: 'categories', label: 'Experience Categories' },
  { key: 'status', label: 'App Status' },
  { key: 'members', label: 'Members' },
  { key: 'audit', label: 'Audit log' },
]

export const SECTION_TITLES: Record<string, string> = Object.fromEntries([
  ...STEPS.map((s) => [s.key, s.label]),
  ...INSIGHT_SECTIONS.map((s) => [s.key, s.label]),
  ...SETTINGS_SECTIONS.map((s) => [s.key, s.label]),
])
