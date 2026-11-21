import type { PulseChannel } from '../../api/client'

// The channels signals are heard in, in the order the grid shows them: customer-meeting transcripts and Slack. Kept in step with server/pulse-topics.ts (a test compares them).
export const CHANNELS: { key: PulseChannel; label: string }[] = [
  { key: 'call_notes', label: 'Call notes' },
  { key: 'slack', label: 'Slack' },
]
export const CHANNEL_LABEL = Object.fromEntries(CHANNELS.map((c) => [c.key, c.label])) as Record<PulseChannel, string>
