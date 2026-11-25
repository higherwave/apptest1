import type { PulseChannel } from '../../api/client'

// The channels signals are heard in, in the order the grid shows them: customer-meeting transcripts, Slack and Salesforce opportunity notes. Kept in step with server/pulse-topics.ts (a test compares them).
export const CHANNELS: { key: PulseChannel; label: string }[] = [
  { key: 'call_notes', label: 'Call notes' },
  { key: 'slack', label: 'Slack' },
  { key: 'salesforce', label: 'Salesforce' },
  { key: 'support_tickets', label: 'Support tickets' },
]
/** The channels worth showing: those with at least one signal in the topics (a workspace with no support system connected has no Support tickets column). All of them while there is nothing yet. */
export const activeChannels = (topics: { channels: Partial<Record<PulseChannel, number>> }[]) => {
  const used = CHANNELS.filter((c) => topics.some((t) => (t.channels[c.key] ?? 0) > 0))
  return used.length ? used : CHANNELS
}
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<PulseChannel, string>
