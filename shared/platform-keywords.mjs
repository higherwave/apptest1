// What the simulated matcher looks for, per platform theme (keyed by title). Phase 1 stand-in: real matching
// replaces this with the AI plan's matcher. Used by the seed and by the API when a project is analysed.
export const PLATFORM_KEYWORDS = {
  'Provider availability is hard to see': ['availab\\w*', 'slots?', 'calendar', 'open times'],
  'Insurance coverage is unclear up front': ['insurance', 'coverage', 'copay', 'in-network', 'network'],
  'People expect to reschedule without calling': ['reschedul\\w*', 'cancel\\w*', 'phone call', 'calling'],
  'A prep checklist before the visit is valued': ['prepar\\w*', 'checklist', 'reminders?', 'what to bring'],
  'Fees appear late at checkout': ['fees?', 'prices?', 'surprises?', 'total cost'],
};
