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

// The Save button with the save state under it, for the right-hand end of a page's title row.
export function SaveControls({ dirty, saving, canEdit, savedAt, saveLabel = 'Save', actionable, note, onSave }: SaveBarProps) {
  const status = dirty ? 'Unsaved changes' : savedAt ? `All changes saved at ${savedAt}` : 'All changes saved'
  return (
    <div className={styles.controls}>
      <Button kind="primary" size="md" disabled={!canEdit || !(dirty || actionable) || saving} onClick={onSave}>
        {saving ? 'Working…' : saveLabel}
      </Button>
      <p className={styles.status} role="status">
        <span className={styles.dot} data-state={dirty ? 'dirty' : 'saved'} aria-hidden />
        {status}
      </p>
      {note && (
        <Tag size="sm" type="warm-gray">
          {note}
        </Tag>
      )}
    </div>
  )
}

// What can go wrong under the title row: editing locked, a conflict with someone else's save, or a failed save.
export function SaveAlerts({ canEdit, conflict, error, onReload, onOverwrite }: SaveBarProps) {
  if (canEdit && !conflict && !error) return null
  return (
    <div className={styles.wrap}>
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
