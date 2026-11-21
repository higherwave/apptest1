import type { PulseChannel } from '../../api/client'

// The fixed list of channels signals are heard in, in the order the grid shows them. Kept in step with server/pulse-topics.ts (a test compares them).
export const CHANNELS: { key: PulseChannel; label: string }[] = [
  { key: 'call_notes', label: 'Call notes' },
  { key: 'support_tickets', label: 'Support tickets' },
  { key: 'slack', label: 'Slack' },
  { key: 'conference', label: 'Conference' },
  { key: 'other', label: 'Other' },
]
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<PulseChannel, string>
