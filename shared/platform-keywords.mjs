// What the simulated matcher looks for, per platform theme (keyed by title). Phase 1 stand-in: real matching
// replaces this with the AI plan's matcher. Used by the seed and by the API when a project is analysed.
export const PLATFORM_KEYWORDS = {
  'Provider availability is hard to see': ['availab\\w*', 'slots?', 'calendar', 'open times'],
  'Insurance coverage is unclear up front': ['insurance', 'coverage', 'copay', 'in-network', 'network'],
  'People expect to reschedule without calling': ['reschedul\\w*', 'cancel\\w*', 'phone call', 'calling'],
  'A prep checklist before the visit is valued': ['prepar\\w*', 'checklist', 'reminders?', 'what to bring'],
  'Fees appear late at checkout': ['fees?', 'prices?', 'surprises?', 'total cost'],
  // Anchor CX (the second demo story; see db/seed/anchor-cx/README.md).
  'The health score can’t be explained, so it isn’t trusted': ['health score', 'explain\\w*', 'why (?:the|a|it|this) score'],
  'Support and success lose context at the handoff': ['hand\\s?offs?', 'escalat\\w*', 'lose the thread', 'full ticket'],
  'Preparing a renewal means jumping between tabs and tools': ['tabs?', 'jump\\w*', 'hopping', 'renewals?'],
  'Alerts are noisy and early warning comes late': ['alerts?', 'nois\\w*', 'early (?:warning|signal)', 'digest'],
  'Reporting to leadership is manual and out of date': ['report\\w*', 'spreadsheets?', 'slides', 'quarterly'],
  'Playbooks should adapt to the customer segment': ['playbooks?', 'segments?', 'rigid'],
  'The customer timeline saves real time': ['timeline'],
};
