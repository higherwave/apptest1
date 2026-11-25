import type { PulseTopic } from '../../api/client'

export const TREND: Record<PulseTopic['trend'], { label: string; type: 'red' | 'blue' | 'gray' | 'green' }> = {
  new: { label: 'New', type: 'blue' },
  rising: { label: 'Rising', type: 'red' },
  steady: { label: 'Steady', type: 'gray' },
  fading: { label: 'Fading', type: 'green' },
}

/** A topic with only two signals is just emerging: it sits at the bottom, and the usual trend tag takes over once it grows. */
export const EMERGING_AT = 2
/** Quiet (nothing heard for about two months) comes first, then Emerging, then how the signals are trending. */
export const trendTag = (t: Pick<PulseTopic, 'signals' | 'trend' | 'quiet'>): { label: string; type: 'red' | 'blue' | 'gray' | 'green' | 'purple' } => (t.quiet ? { label: 'Quiet', type: 'gray' } : t.signals <= EMERGING_AT ? { label: 'Emerging', type: 'purple' } : TREND[t.trend])
