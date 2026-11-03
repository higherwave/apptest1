import type { InsightsThemes } from '../../api/client'

type Status = InsightsThemes['themes'][number]['status']

// What became of a theme, as a tag: the words and the colour. Shared by every Platform Insights screen that shows one.
export const STATUS: Record<Status, { label: string; tag: 'green' | 'red' | 'gray' | 'blue' | 'outline' }> = {
  not_addressed: { label: 'Not addressed', tag: 'outline' },
  in_progress: { label: 'In progress', tag: 'blue' },
  too_early: { label: 'Too early to tell', tag: 'gray' },
  worked: { label: 'Worked', tag: 'green' },
  needs_attention: { label: 'Needs attention', tag: 'red' },
}

export type Origin = 'customer' | 'team' | 'both'
/** Where a theme was heard. Customers are reach and priority; the team is confirmation. */
export const ORIGIN_LABEL: Record<Origin, string> = { customer: 'Customers', team: 'Team', both: 'Customers + Team' }
export const teamConversations = (n: number) => `${n} team ${n === 1 ? 'conversation' : 'conversations'}`
