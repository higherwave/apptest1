import { Tag } from '@carbon/react'
import { useAiStatus } from '../api/hooks'

// Whether the AI steps run on the live model or on the built-in simulation. It sits at the left of the header.
export function AiBadge() {
  const ai = useAiStatus()
  if (!ai.data) return null
  return (
    <Tag size="sm" type={ai.data.mode === 'live' ? 'blue' : 'gray'}>
      {ai.data.mode === 'live' ? 'AI: live' : 'AI: simulated'}
    </Tag>
  )
}
