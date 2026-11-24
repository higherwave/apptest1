import type { PulseTopic } from '../../api/client'

export const TREND: Record<PulseTopic['trend'], { label: string; type: 'red' | 'blue' | 'gray' | 'green' }> = {
  new: { label: 'New', type: 'blue' },
  rising: { label: 'Rising', type: 'red' },
  steady: { label: 'Steady', type: 'gray' },
  fading: { label: 'Fading', type: 'green' },
}

/** A topic with only two signals is just emerging: it sits at the bottom, and the usual trend tag takes over once it grows. */
export const EMERGING_AT = 2
export const trendTag = (t: Pick<PulseTopic, 'signals' | 'trend'>): { label: string; type: 'red' | 'blue' | 'gray' | 'green' | 'purple' } => (t.signals <= EMERGING_AT ? { label: 'Emerging', type: 'purple' } : TREND[t.trend])
