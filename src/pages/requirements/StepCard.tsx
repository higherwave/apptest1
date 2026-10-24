import { Button, Tag, TextArea } from '@carbon/react'
import type { SpecStep } from '../../api/client'
import { useTypedText } from './useTypedText'
import styles from './StepCard.module.scss'

export type StepCardProps = {
  step: SpecStep
  canEdit: boolean
  busy: boolean
  /** The step was drafted just now in this session, so its text is revealed gradually. */
  fresh: boolean
  editing: boolean
  draft: string
  onDraft: (text: string) => void
  onEditStart: () => void
  onEditSave: () => void
  onEditCancel: () => void
  onApprove: () => void
  onRedo: () => void
}

const STATUS_LABEL = { pending: 'Waiting', review: 'Needs review', approved: 'Approved' } as const

// Presentational: one of the eight steps. A waiting step is dimmed; a step under review shows Approve and Redo; an
// approved step can still be edited, which sends it back for review.
export function StepCard({ step, canEdit, busy, fresh, editing, draft, onDraft, onEditStart, onEditSave, onEditCancel, onApprove, onRedo }: StepCardProps) {
  const { shown, done } = useTypedText(step.text ?? '', fresh)
  const open = step.status !== 'pending'
  const editable = canEdit && open && !editing
  return (
    <article className={styles.card} data-state={step.status} aria-label={`Step ${step.position}: ${step.title}`}>
      <header className={styles.head}>
        <span className={styles.dot} aria-hidden="true">
          {step.position}
        </span>
        <h3 className={styles.title}>{step.title}</h3>
        <span className={styles.state} data-state={step.status}>
          {STATUS_LABEL[step.status]}
        </span>
        {editable && done && (
          <Button kind="ghost" size="sm" disabled={busy} onClick={onEditStart}>
            Edit
          </Button>
        )}
      </header>

      {open && (
        <div className={styles.body}>
          {editing ? (
            <TextArea id={`step-text-${step.position}`} labelText={`Text of step ${step.position}`} hideLabel rows={6} value={draft} onChange={(e) => onDraft(e.target.value)} />
          ) : (
            <p className={styles.text}>{shown}</p>
          )}
          {step.behind && !editing && <p className={styles.behind}>An earlier step changed after this one was written. Redo it if it should follow the change.</p>}
          {(step.edited || step.revision > 0) && !editing && (
            <div className={styles.flags}>
              {step.edited && (
                <Tag size="sm" type="warm-gray">
                  Edited
                </Tag>
              )}
              {step.revision > 0 && (
                <Tag size="sm" type="gray">
                  Redone {step.revision === 1 ? 'once' : `${step.revision} times`}
                </Tag>
              )}
            </div>
          )}

          {done && step.evidence.length > 0 && (
            <div className={styles.evidence}>
              <span className={styles.label}>Evidence</span>
              {step.evidence.map((e) => (
                <Tag key={e.themeId} className={styles.tag} size="sm" type="gray">
                  {e.label}
                </Tag>
              ))}
            </div>
          )}

          {done && step.alternatives.length > 0 && !editing && (
            <div className={styles.alternatives}>
              <span className={styles.label}>Considered and rejected</span>
              {step.alternatives.map((a) => (
                <p key={a.title} className={styles.alternative}>
                  <span className={styles.struck}>{a.title}</span> {a.reason}
                </p>
              ))}
            </div>
          )}

          {editing && (
            <div className={styles.actions}>
              <Button kind="primary" size="md" disabled={busy || !draft.trim()} onClick={onEditSave}>
                Save edit
              </Button>
              <Button kind="ghost" size="md" onClick={onEditCancel}>
                Cancel
              </Button>
            </div>
          )}
          {!editing && step.status === 'review' && done && canEdit && (
            <div className={styles.actions}>
              <Button kind="primary" size="md" disabled={busy} onClick={onApprove}>
                Approve
              </Button>
              <Button kind="secondary" size="md" disabled={busy} onClick={onRedo}>
                Redo with instructions
              </Button>
            </div>
          )}
        </div>
      )}
    </article>
  )
}
