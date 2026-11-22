import type { PulseSignal } from '../../api/client'

export const KINDS: { key: PulseSignal['kind']; label: string }[] = [
  { key: 'complaint', label: 'Complaint' },
  { key: 'request', label: 'Request' },
  { key: 'praise', label: 'Praise' },
  { key: 'question', label: 'Question' },
  { key: 'other', label: 'Other' },
]
export const KIND_TAG: Record<PulseSignal['kind'], 'red' | 'blue' | 'green' | 'purple' | 'gray'> = { complaint: 'red', request: 'blue', praise: 'green', question: 'purple', other: 'gray' }
