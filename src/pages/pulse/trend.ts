import type { PulseTopic } from '../../api/client'

export const TREND: Record<PulseTopic['trend'], { label: string; type: 'red' | 'blue' | 'gray' | 'green' }> = {
  new: { label: 'New', type: 'blue' },
  rising: { label: 'Rising', type: 'red' },
  steady: { label: 'Steady', type: 'gray' },
  fading: { label: 'Fading', type: 'green' },
}
