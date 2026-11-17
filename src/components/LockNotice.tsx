import { InlineNotification } from '@carbon/react'
import { useProjectLock } from '../api/hooks'
import { T } from '../../shared/terms.mjs'
import styles from './LockNotice.module.scss'

/** What a locked project says: its requirements are published, so its transcripts, themes and requirements no longer change. Nothing when the project is open. */
export const lockText = (permanent: boolean) =>
  permanent
    ? 'The requirements are published and Jira tickets have been created, so this project is locked for good. Changes from here happen in a new project.'
    : `The requirements are published, so this project is locked: its transcripts, themes and requirements no longer change. Changes from here happen in a new project. A workspace owner or the final ${T.approver} can return the requirements to draft until the first Jira ticket is created.`

export function LockNotice({ projectId }: { projectId: string }) {
  const lock = useProjectLock(projectId).data
  if (!lock?.locked) return null
  return (
    <div className={styles.notice} data-testid="project-lock">
      <InlineNotification kind="info" lowContrast hideCloseButton title="Project locked" subtitle={lockText(lock.permanent)} />
    </div>
  )
}
