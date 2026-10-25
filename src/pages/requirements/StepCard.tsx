import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, Tag, TextArea } from '@carbon/react'
import { useState } from 'react'
import type { SpecStep } from '../../api/client'
import { useTypedText } from './useTypedText'
import styles from './StepCard.module.scss'

export type StepCardProps = {
  step: SpecStep
  canEdit: boolean
  busy: boolean
  /** The step was drafted just now in this session, so its text is revealed gradually. */
  fresh: boolean
  /** The model is working on this step: writing it for the first time, or rewriting it after a redo. */
  progress?: 'writing' | 'rewriting'
  /** Why the last action on this step failed. */
  error?: string
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
// approved step folds down to its title row (open it again at any time) and can still be edited, which sends it back for review.
export function StepCard({ step, canEdit, busy, fresh, progress, error, editing, draft, onDraft, onEditStart, onEditSave, onEditCancel, onApprove, onRedo }: StepCardProps) {
  const { shown, done } = useTypedText(step.text ?? '', fresh)
  // A choice made by opening or closing the card holds only while the step keeps its status; a new status starts from the default again
  // (approved folds, anything else is open), so approving a step folds it away.
  const [choice, setChoice] = useState<{ status: string; open: boolean } | null>(null)
  const started = step.status !== 'pending' || progress === 'writing'
  const open = started && (editing || !!progress || (choice?.status === step.status ? choice.open : step.status !== 'approved'))
  const foldable = step.status === 'approved' && !editing
  const editable = canEdit && open && !editing && step.status !== 'pending'
  return (
    <article className={styles.card} data-state={progress === 'writing' ? 'review' : step.status} aria-busy={progress ? true : undefined} aria-label={`Step ${step.position}: ${step.title}`}>
      <header className={styles.head}>
        <span className={styles.dot} aria-hidden="true">
          {step.position}
        </span>
        <h3 className={styles.title}>{step.title}</h3>
        <span className={styles.state} data-state={step.status}>
          {STATUS_LABEL[step.status]}
        </span>
        {editable && done && !progress && (
          <Button kind="ghost" size="sm" disabled={busy} onClick={onEditStart}>
            Edit
          </Button>
        )}
        {foldable && (
          <Button
            kind="ghost"
            size="sm"
            hasIconOnly
            renderIcon={open ? ChevronUp : ChevronDown}
            iconDescription={open ? `Collapse step ${step.position}` : `Expand step ${step.position}`}
            aria-expanded={open}
            onClick={() => setChoice({ status: step.status, open: !open })}
          />
        )}
      </header>

      {open && progress && (
        <div className={styles.working} role="status">
          <Loading small withOverlay={false} description={progress === 'writing' ? `Writing step ${step.position}` : `Rewriting step ${step.position}`} />
          <span>{progress === 'writing' ? 'Writing this step from the approved ones. This can take up to half a minute.' : 'Rewriting this step with your instructions. This can take up to half a minute.'}</span>
        </div>
      )}

      {open && !progress && (
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
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not done" subtitle={error} />}
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
