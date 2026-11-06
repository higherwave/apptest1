import { Add, ArrowLeft, ArrowRight, Close } from '@carbon/icons-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { Button, Dropdown, InlineNotification, TextArea, TextInput } from '@carbon/react'
import { addBackstage, addStage, KINDS, MAX_STAGES, moveStage, patchBackstage, patchStage, removeBackstage, removeStage, type BackstageKind, type Draft } from './blueprintDraft'
import map from '../themes/JourneyView.module.scss'
import styles from './WorkflowJourney.module.scss'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

export type BlueprintEditorProps = {
  draft: Draft
  onChange: (draft: Draft) => void
  errorText?: string
  /** Delete, Cancel and Save: at the right of the name and description. */
  actions?: ReactNode
}

// The workflow, editable: the same matrix as the journey, with a box for everything the blueprint holds, and a slim lane at its far right to add a stage. The
// draft lives in the page, which also holds the buttons (BlueprintActions: Delete, Cancel, Save), shown beside the name and description; nothing is saved until Save.
export function BlueprintEditor({ draft, onChange: set, errorText, actions }: BlueprintEditorProps) {
  const columns = draft.stages.length
  // Adding a stage brings it, and the lane beside it, into view when the stages are wider than the page.
  const scroller = useRef<HTMLDivElement>(null)
  const before = useRef(columns)
  useEffect(() => {
    if (columns > before.current) scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' })
    before.current = columns
  }, [columns])

  return (
    <div className={styles.editor}>
      <div className={styles.editorTop}>
        <div className={styles.editorFields}>
          <TextInput id="bp-name" labelText="Workflow name" value={draft.name} maxLength={80} onChange={(e) => set({ ...draft, name: e.target.value })} />
          <TextInput id="bp-description" labelText="What it covers (optional)" value={draft.description} maxLength={400} onChange={(e) => set({ ...draft, description: e.target.value })} />
        </div>
        {actions && <div className={styles.editorActions}>{actions}</div>}
      </div>
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={errorText} />}

      <div className={map.scroll} ref={scroller}>
        <div className={map.map} data-columns={columns} data-add="true" data-testid="blueprint-editor">
          <div className={map.row}>
            <div className={map.corner} />
            {draft.stages.map((s, i) => (
              <div key={s.key} className={map.stageHead}>
                <span className={map.stageNumber}>Stage {i + 1}</span>
                <span className={map.stageName}>{s.name.trim() || 'Unnamed'}</span>
              </div>
            ))}
            <div className={styles.addHead}>
              <Button kind="ghost" size="sm" hasIconOnly className={styles.addButton} renderIcon={Add} iconDescription="Add stage" tooltipPosition="left" data-testid="add-stage" disabled={columns >= MAX_STAGES} onClick={() => set(addStage(draft))} />
            </div>
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
            <div className={styles.addLane} aria-hidden />
          </div>

          {([['good', 'What good looks like'], ['signal', 'Signal to watch'], ['handoff', 'Handoff out of the stage']] as const).map(([field, label]) => (
            <div key={field} className={map.row}>
              <div className={map.rowLabel}>{label}</div>
              {draft.stages.map((s, i) => (
                <div key={s.key} className={styles.editCell}>
                  <TextArea id={`bp-${s.key}-${field}`} labelText={`${label}, stage ${i + 1}`} hideLabel rows={3} maxLength={300} value={s[field]} onChange={(e) => set(patchStage(draft, s.key, { [field]: e.target.value }))} />
                </div>
              ))}
              <div className={styles.addLane} aria-hidden />
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
            <div className={styles.addLane} aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}
