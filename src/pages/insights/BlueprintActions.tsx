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

// The buttons of Edit Workflow: Delete, Cancel and Save, at the right of the workflow's name and description. Delete asks first (the dialog below), which says how
// many projects it takes off the workflow. What is still missing before it can be saved is named beside them.
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
        primaryButtonText={deleting ? 'Deleting…' : 'Delete'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={deleting}
        onRequestClose={() => setAskDelete(false)}
        onRequestSubmit={() => onDelete?.()}
      >
        <p className={styles.confirm}>
          {projectCount > 0 && `${projectCount === 1 ? 'A project is' : `${projectCount} projects are`} on this workflow and will be taken off it. `}
          Its stages and backstage are removed. This cannot be undone, though the audit log keeps a record.
        </p>
      </Modal>
    </>
  )
}
