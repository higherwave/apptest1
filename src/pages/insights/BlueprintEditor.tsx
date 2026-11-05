import { Add, ArrowLeft, ArrowRight, Close } from '@carbon/icons-react'
import { Button, Dropdown, InlineNotification, Modal, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import { addBackstage, addStage, isDirty, KINDS, moveStage, patchBackstage, patchStage, problems, removeBackstage, removeStage, type BackstageKind, type Draft } from './blueprintDraft'
import map from '../themes/JourneyView.module.scss'
import styles from './WorkflowJourney.module.scss'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

export type BlueprintEditorProps = {
  initial: Draft
  projectCount: number
  saving: boolean
  errorText?: string
  onSave: (draft: Draft) => void
  onCancel: () => void
  /** Only for a workflow that exists. */
  onDelete?: () => void
  deleting?: boolean
}

// The workflow, editable: the same matrix as the journey, with a box for everything the blueprint holds. Nothing is saved until Save; the
// parent keys this by the workflow and its version, so a save (or someone else's) starts it again from what is stored.
export function BlueprintEditor({ initial, projectCount, saving, errorText, onSave, onCancel, onDelete, deleting }: BlueprintEditorProps) {
  const [draft, setDraft] = useState(initial)
  const [askDelete, setAskDelete] = useState(false)
  const todo = problems(draft)
  const dirty = isDirty(draft, initial)
  const set = (next: Draft) => setDraft(next)
  const columns = draft.stages.length

  return (
    <div className={styles.emptyBox}>
      <div className={styles.editorTop}>
        <TextInput id="bp-name" labelText="Workflow name" value={draft.name} maxLength={80} onChange={(e) => set({ ...draft, name: e.target.value })} />
        <TextInput id="bp-description" labelText="What it covers (optional)" value={draft.description} maxLength={400} onChange={(e) => set({ ...draft, description: e.target.value })} />
      </div>
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={errorText} />}

      <div className={map.scroll}>
        <div className={map.map} data-columns={columns} data-testid="blueprint-editor">
          <div className={map.row}>
            <div className={map.corner} />
            {draft.stages.map((s, i) => (
              <div key={s.key} className={map.stageHead}>
                <span className={map.stageNumber}>Stage {i + 1}</span>
                <span className={map.stageName}>{s.name.trim() || 'Unnamed'}</span>
              </div>
            ))}
          </div>

          <div className={map.row}>
            <div className={map.rowLabel}>Stage name</div>
            {draft.stages.map((s, i) => (
              <div key={s.key} className={styles.editCell}>
                <TextInput id={`bp-${s.key}-name`} labelText={`Name of stage ${i + 1}`} hideLabel size="sm" value={s.name} maxLength={80} onChange={(e) => set(patchStage(draft, s.key, { name: e.target.value }))} />
                <div className={styles.stageTools}>
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={ArrowLeft} iconDescription={`Move ${s.name || `stage ${i + 1}`} earlier`} tooltipPosition="bottom" disabled={i === 0} onClick={() => set(moveStage(draft, s.key, -1))} />
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={ArrowRight} iconDescription={`Move ${s.name || `stage ${i + 1}`} later`} tooltipPosition="bottom" disabled={i === columns - 1} onClick={() => set(moveStage(draft, s.key, 1))} />
                  <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription={`Remove ${s.name || `stage ${i + 1}`}`} tooltipPosition="bottom" disabled={columns <= 1} onClick={() => set(removeStage(draft, s.key))} />
                </div>
              </div>
            ))}
          </div>

          {([['good', 'What good looks like'], ['signal', 'Signal to watch'], ['handoff', 'Handoff out of the stage']] as const).map(([field, label]) => (
            <div key={field} className={map.row}>
              <div className={map.rowLabel}>{label}</div>
              {draft.stages.map((s, i) => (
                <div key={s.key} className={styles.editCell}>
                  <TextArea id={`bp-${s.key}-${field}`} labelText={`${label}, stage ${i + 1}`} hideLabel rows={3} maxLength={300} value={s[field]} onChange={(e) => set(patchStage(draft, s.key, { [field]: e.target.value }))} />
                </div>
              ))}
            </div>
          ))}

          <div className={cx(map.row, map.backstageRow)}>
            <div className={map.rowLabel}>Backstage</div>
            {draft.stages.map((s, i) => (
              <div key={s.key} className={styles.editCell}>
                {s.backstage.map((b, n) => (
                  <div key={b.key} className={styles.entry} data-testid="backstage-entry">
                    <div className={styles.entryLine}>
                      <Dropdown
                        id={`bp-${b.key}-kind`}
                        titleText={`Kind of backstage entry ${n + 1}, stage ${i + 1}`}
                        hideLabel
                        label="Kind"
                        size="sm"
                        className={styles.grow}
                        items={KINDS}
                        itemToString={(k) => k ?? ''}
                        selectedItem={b.kind}
                        onChange={({ selectedItem }) => selectedItem && set(patchBackstage(draft, s.key, b.key, { kind: selectedItem as BackstageKind }))}
                      />
                      <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription={`Remove ${b.name || 'this entry'} from ${s.name || `stage ${i + 1}`}`} tooltipPosition="left" onClick={() => set(removeBackstage(draft, s.key, b.key))} />
                    </div>
                    <TextArea id={`bp-${b.key}-name`} labelText={`Name of backstage entry ${n + 1}, stage ${i + 1}`} hideLabel placeholder="Team, system or process" rows={2} maxLength={100} value={b.name} onChange={(e) => set(patchBackstage(draft, s.key, b.key, { name: e.target.value }))} />
                    <TextInput id={`bp-${b.key}-owner`} labelText={`Owner of backstage entry ${n + 1}, stage ${i + 1}`} hideLabel placeholder="Owner" size="sm" value={b.owner} maxLength={100} onChange={(e) => set(patchBackstage(draft, s.key, b.key, { owner: e.target.value }))} />
                  </div>
                ))}
                <Button kind="tertiary" size="sm" renderIcon={Add} onClick={() => set(addBackstage(draft, s.key))}>
                  Add backstage
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.editorFoot}>
        <Button kind="tertiary" size="md" renderIcon={Add} onClick={() => set(addStage(draft))}>
          Add stage
        </Button>
        <span className={styles.spacer} />
        {todo.length > 0 && <p className={styles.problems}>{todo[0]}</p>}
        {onDelete && (
          <Button kind="danger--ghost" size="md" onClick={() => setAskDelete(true)}>
            Delete workflow
          </Button>
        )}
        <Button kind="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button kind="primary" size="md" disabled={saving || todo.length > 0 || (!dirty && initial.id !== null)} onClick={() => onSave(draft)}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

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
    </div>
  )
}
