import { Button, InlineNotification, Tag } from '@carbon/react'
import styles from './SaveBar.module.scss'

export type SaveBarProps = {
  dirty: boolean
  saving: boolean
  canEdit: boolean
  /** Set when the server refused the save because someone else changed the project first. */
  conflict: boolean
  error?: string
  savedAt?: string
  onSave: () => void
  onReload: () => void
  onOverwrite: () => void
}

// Presentational: the save state, the Save button, and the choices offered after a conflict.
export function SaveBar({ dirty, saving, canEdit, conflict, error, savedAt, onSave, onReload, onOverwrite }: SaveBarProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <Tag size="sm" type={dirty ? 'warm-gray' : 'green'}>
          {dirty ? 'Unsaved changes' : savedAt ? `All changes saved at ${savedAt}` : 'All changes saved'}
        </Tag>
        <Button kind="primary" size="md" disabled={!canEdit || !dirty || saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      {!canEdit && <p className={styles.note}>Editing is locked. Use &quot;Unlock editing&quot; at the top of the page.</p>}
      {conflict && (
        <>
          <InlineNotification kind="warning" lowContrast hideCloseButton title="Changed by someone else" subtitle="This project was saved by someone else since you opened it. Nothing was overwritten." />
          {/* Carbon's notification cannot contain buttons, so the choices sit beside it. */}
          <div className={styles.choices}>
            <Button kind="tertiary" size="sm" onClick={onReload}>
              Reload their version
            </Button>
            <Button kind="primary" size="sm" onClick={onOverwrite}>
              Overwrite with mine
            </Button>
          </div>
        </>
      )}
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} />}
    </div>
  )
}
