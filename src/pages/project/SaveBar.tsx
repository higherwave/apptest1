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
  /** The button's label, for a save that does more than save. */
  saveLabel?: string
  /** Something other than unsaved edits makes saving worthwhile, for example an out-of-date analysis. */
  actionable?: boolean
  /** Shown next to the state, for example "Analysis is out of date". */
  note?: string
  onSave: () => void
  onReload: () => void
  onOverwrite: () => void
}

// Presentational: the save state, the Save button, and the choices offered after a conflict.
export function SaveBar({ dirty, saving, canEdit, conflict, error, savedAt, saveLabel = 'Save', actionable, note, onSave, onReload, onOverwrite }: SaveBarProps) {
  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <Tag size="sm" type={dirty ? 'warm-gray' : 'green'}>
          {dirty ? 'Unsaved changes' : savedAt ? `All changes saved at ${savedAt}` : 'All changes saved'}
        </Tag>
        {note && (
          <Tag size="sm" type="warm-gray">
            {note}
          </Tag>
        )}
        <Button kind="primary" size="md" disabled={!canEdit || !(dirty || actionable) || saving} onClick={onSave}>
          {saving ? 'Working…' : saveLabel}
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
