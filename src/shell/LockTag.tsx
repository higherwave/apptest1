import { Tag } from '@carbon/react'
import { useProjectLock } from '../api/hooks'
import { lockText } from '../components/lockText'

// Beside the status badge in a locked project's title bar; the explanation is its tooltip and the Requirements page says more.
export function LockTag({ projectId }: { projectId: string }) {
  const lock = useProjectLock(projectId).data
  if (!lock?.locked) return null
  return (
    <Tag size="sm" type="blue" title={lockText(lock.permanent)} data-testid="project-lock">
      Project locked
    </Tag>
  )
}
