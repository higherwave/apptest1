// The eight project steps in order, grouped as in the prototype's side menu.
export const STEP_GROUPS = ['Plan', 'Analyze', 'Deliver'] as const
export type StepGroup = (typeof STEP_GROUPS)[number]

export const STEPS: { key: string; label: string; group: StepGroup }[] = [
  { key: 'plan', label: 'Test Plan', group: 'Plan' },
  { key: 'tasks', label: 'Task List', group: 'Plan' },
  { key: 'transcripts', label: 'Transcripts', group: 'Plan' },
  { key: 'themes', label: 'Themes', group: 'Analyze' },
  { key: 'journey', label: 'Journey Map', group: 'Analyze' },
  { key: 'prio', label: 'Priorities', group: 'Analyze' },
  { key: 'requirements', label: 'Requirements', group: 'Deliver' },
  { key: 'stories', label: 'Stories', group: 'Deliver' },
]

export const INSIGHT_SECTIONS = [
  { key: 'themes', label: 'Platform Themes' },
  { key: 'case-studies', label: 'Case Studies' },
  { key: 'onboarding', label: 'Onboarding' },
]

export const SECTION_TITLES: Record<string, string> = Object.fromEntries([
  ...STEPS.map((s) => [s.key, s.label]),
  ...INSIGHT_SECTIONS.map((s) => [s.key, s.label]),
])
