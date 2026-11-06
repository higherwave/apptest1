import { Button, Modal } from '@carbon/react'
import { useState } from 'react'
import { isDirty, problems, type Draft } from './blueprintDraft'
import styles from './WorkflowJourney.module.scss'

export type BlueprintActionsProps = {
  draft: Draft
  /** What was loaded, to tell whether anything changed. */
  initial: Draft
  projectCount: number
  saving: boolean
  deleting: boolean
  onSave: () => void
  onCancel: () => void
  /** Only for a workflow that exists. */
  onDelete?: () => void
}

// The buttons of Edit Workflow: Delete, Cancel and Save, at the right of the workflow's name and description. Delete asks first (the dialog below), and refuses
// while projects are on the workflow. What is still missing before it can be saved is named beside them.
export function BlueprintActions({ draft, initial, projectCount, saving, deleting, onSave, onCancel, onDelete }: BlueprintActionsProps) {
  const [askDelete, setAskDelete] = useState(false)
  const todo = problems(draft)
  const dirty = isDirty(draft, initial)
  return (
    <>
      {todo.length > 0 && <p className={styles.problems}>{todo[0]}</p>}
      {onDelete && (
        <Button kind="danger--ghost" size="md" onClick={() => setAskDelete(true)}>
          Delete
        </Button>
      )}
      <Button kind="secondary" size="md" onClick={onCancel}>
        Cancel
      </Button>
      <Button kind="primary" size="md" disabled={saving || todo.length > 0 || (!dirty && initial.id !== null)} onClick={onSave}>
        {saving ? 'Saving…' : 'Save'}
      </Button>

      <Modal
        open={askDelete}
        danger
        size="sm"
        modalHeading={`Delete ${initial.name || 'this workflow'}?`}
        primaryButtonText={deleting ? 'Deleting…' : projectCount > 0 ? 'Close' : 'Delete'}
        secondaryButtonText={projectCount > 0 ? undefined : 'Cancel'}
        primaryButtonDisabled={deleting}
        onRequestClose={() => setAskDelete(false)}
        onRequestSubmit={() => (projectCount > 0 ? setAskDelete(false) : onDelete?.())}
      >
        <p className={styles.confirm}>
          {projectCount > 0
            ? `${projectCount === 1 ? 'A project is' : `${projectCount} projects are`} on this workflow. Take them off it (on each project's Journey Map) before deleting it.`
            : 'Its stages and backstage are removed. This cannot be undone, though the audit log keeps a record.'}
        </p>
      </Modal>
    </>
  )
}
