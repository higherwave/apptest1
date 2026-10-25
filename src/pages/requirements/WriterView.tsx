import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, Modal, Tag, TextArea } from '@carbon/react'
import { useEffect, useRef, useState } from 'react'
import type { BoardSyncPlan, SpecDetail, SpecStep } from '../../api/client'
import { CATEGORY_LABEL } from '../themes/themeEdits'
import { ClampedBlock } from './ClampedBlock'
import { StepCard } from './StepCard'
import styles from './WriterView.module.scss'

/** What the page is busy with, step by step: approving a step, then (once that has gone through) writing the next one; or a redo. */
export type StepWork = { kind: 'approve' | 'write' | 'redo'; id: string; nextId: string | null }

export type WriterViewProps = {
  state: 'loading' | 'error' | 'ready'
  spec?: SpecDetail
  canEdit: boolean
  busy: boolean
  errorText?: string
  notice?: string
  freshStepId: string | null
  /** Goes up each time the document has just become ready to publish (or to update the board), so the page brings the banner into view. */
  readyCue: number
  work: StepWork | null
  stepError: { id: string; text: string } | null
  editingId: string | null
  draft: string
  redoing: SpecStep | null
  redoText: string
  onToggleTheme: (themeId: string, included: boolean) => void
  onDraft: (text: string) => void
  onEditStart: (step: SpecStep) => void
  onEditSave: () => void
  onEditCancel: () => void
  onApprove: (step: SpecStep) => void
  onWrite: (step: SpecStep) => void
  onRedo: (step: SpecStep) => void
  onRedoText: (text: string) => void
  onSubmitRedo: () => void
  onCancelRedo: () => void
  onPublish: () => void
  onViewStories: () => void
  onBack: () => void
  boardPlan: BoardSyncPlan | null
  boardError?: string
  onUpdateBoard: () => void
  onCancelBoard: () => void
  onConfirmBoard: () => void
  startOverOpen: boolean
  startOverError?: string
  onStartOver: () => void
  onCancelStartOver: () => void
  onConfirmStartOver: () => void
}

// Presentational: the writer. Steps on the left are reviewed one at a time; the product brief and the requirements
// document on the right build up as steps are approved.
export function WriterView(p: WriterViewProps) {
  const { state, spec } = p
  const [themesOpen, setThemesOpen] = useState(false)
  const banner = useRef<HTMLElement>(null)
  useEffect(() => {
    if (p.readyCue === 0 || !banner.current) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, behavior: calm ? 'auto' : 'smooth' })
    banner.current.focus({ preventScroll: true })
  }, [p.readyCue])
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the document" />
  if (state === 'error' || !spec) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Requirements" subtitle={p.errorText} />
  const published = spec.status === 'published'
  const locked = !p.canEdit

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        {spec.standalone && (
          <Button kind="ghost" size="sm" onClick={p.onBack}>
            ← Back
          </Button>
        )}
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{spec.name}</h1>
          <Tag size="sm" type={published ? 'green' : 'gray'}>
            {published ? 'Published' : 'Draft'}
          </Tag>
          {p.canEdit && !spec.standalone && (
            <Button kind="ghost" size="sm" disabled={p.busy} onClick={p.onStartOver}>
              Start over
            </Button>
          )}
        </div>
        <p className={styles.source}>
          {spec.standalone ? 'Stand-alone document, drafted from a description.' : `Built from ${spec.projectName} · ${spec.sessions} ${spec.sessions === 1 ? 'session' : 'sessions'} · ${spec.themes.length} themes`}
        </p>
      </header>

      {p.canEdit && (spec.canPublish || (published && !spec.standalone && spec.boardChanges !== null && spec.boardChanges > 0)) && (
        <section ref={banner} tabIndex={-1} className={styles.ready} aria-label={spec.canPublish ? 'Ready to publish' : 'Board update waiting'}>
          {spec.canPublish ? (
            <>
              <h2 className={styles.blockTitle}>Ready to publish</h2>
              <p className={styles.para}>
                {spec.standalone
                  ? 'Every step is approved. Publishing marks this document final.'
                  : `Every step is approved. Publishing creates ${spec.preview.requirements} requirements and ${spec.preview.openQuestions} open questions on the Stories board, all in To Do.`}
              </p>
              <Button kind="primary" size="md" disabled={p.busy} onClick={p.onPublish}>
                Publish
              </Button>
            </>
          ) : (
            <>
              <h2 className={styles.blockTitle}>Board update waiting</h2>
              <p className={styles.para}>
                The board no longer matches this document: {spec.boardChanges} {spec.boardChanges === 1 ? 'change is' : 'changes are'} waiting.
              </p>
              <Button kind="primary" size="md" disabled={p.busy} onClick={p.onUpdateBoard}>
                Update board
              </Button>
            </>
          )}
        </section>
      )}

      {spec.stale && !published && (
        <InlineNotification kind="warning" lowContrast hideCloseButton title="Themes changed" subtitle="The project was analyzed again after this document was started. The themes below may no longer match the transcripts. Use Start over to draft it again from the new themes." />
      )}
      {spec.stale && published && (
        <InlineNotification kind="info" lowContrast hideCloseButton title="Themes changed" subtitle="The project was analyzed again after this was published. The stories on the board still point at the themes they were made from." />
      )}
      {p.notice && <InlineNotification kind="info" lowContrast hideCloseButton title="Reloaded" subtitle={p.notice} />}
      {p.errorText && <InlineNotification kind="warning" lowContrast hideCloseButton title="Not done" subtitle={p.errorText} />}

      {spec.themes.length > 0 && (
        <section className={styles.context} aria-label="Themes used">
          <div className={styles.contextHead}>
            <h2 className={styles.label}>Themes used</h2>
            <span className={styles.count}>
              {spec.themes.filter((t) => t.included).length} of {spec.themes.length} {spec.themes.length === 1 ? 'theme' : 'themes'} included
            </span>
            <Button
              kind="ghost"
              size="sm"
              renderIcon={themesOpen ? ChevronUp : ChevronDown}
              aria-expanded={themesOpen}
              aria-controls="themes-used-list"
              onClick={() => setThemesOpen((o) => !o)}
            >
              {themesOpen ? 'Hide themes' : published ? 'Select a theme to include or exclude it' : 'Select a theme to exclude it'}
            </Button>
          </div>
          {themesOpen && (
            <div id="themes-used-list" className={styles.themeList}>
              <div className={styles.chips}>
                {spec.themes.map((t) => (
                  <Button
                    key={t.id}
                    size="sm"
                    kind={t.included ? 'secondary' : 'ghost'}
                    aria-pressed={t.included}
                    disabled={locked || p.busy}
                    title={`${CATEGORY_LABEL[t.category]} · ${t.participantCount} of ${t.totalParticipants} participants`}
                    onClick={() => p.onToggleTheme(t.id, !t.included)}
                  >
                    {t.title}
                  </Button>
                ))}
              </div>
              <p className={styles.help}>
                {published
                  ? 'Click a theme to include or exclude it. The board follows when you choose Update board.'
                  : 'Click a theme to exclude it. Changes apply to steps that have not started yet.'}
              </p>
            </div>
          )}
        </section>
      )}

      <div className={styles.columns}>
        <section className={styles.steps} aria-label="Agent reasoning">
          <h2 className={styles.label}>Agent reasoning</h2>
          {spec.steps.map((step) => (
            <StepCard
              key={step.id}
              step={p.work?.kind === 'approve' && p.work.id === step.id ? { ...step, status: 'approved' } : step}
              progress={p.work?.kind === 'approve' && p.work.id === step.id ? 'approving' : p.work?.nextId === step.id ? 'writing' : p.work?.kind === 'redo' && p.work.id === step.id ? 'rewriting' : undefined}
              error={p.stepError?.id === step.id ? p.stepError.text : undefined}
              canEdit={p.canEdit}
              busy={p.busy}
              fresh={p.freshStepId === step.id}
              editing={p.editingId === step.id}
              draft={p.draft}
              onDraft={p.onDraft}
              onEditStart={() => p.onEditStart(step)}
              onEditSave={p.onEditSave}
              onEditCancel={p.onEditCancel}
              onApprove={() => p.onApprove(step)}
              canWrite={p.canEdit && !published && step.status === 'pending' && (spec.steps.find((s) => s.position === step.position - 1)?.status ?? 'approved') === 'approved'}
              onWrite={() => p.onWrite(step)}
              onRedo={() => p.onRedo(step)}
            />
          ))}
        </section>

        <aside className={styles.output} aria-label="Output">
          <h2 className={styles.label}>Output</h2>
          <div className={styles.brief}>
            <h3 className={styles.blockTitle}>Product brief</h3>
            {!spec.brief.problem && <p className={styles.muted}>The brief builds as steps 1 to 3 are approved.</p>}
            {spec.brief.problem && (
              <>
                <h4 className={styles.small}>Problem</h4>
                <ClampedBlock label="the problem">
                  <p className={styles.para}>{spec.brief.problem}</p>
                </ClampedBlock>
              </>
            )}
            {spec.brief.users && (
              <>
                <h4 className={styles.small}>Users</h4>
                <ClampedBlock label="the users">
                  <p className={styles.para}>{spec.brief.users}</p>
                </ClampedBlock>
              </>
            )}
            {spec.brief.goals && (
              <>
                <h4 className={styles.small}>Goals</h4>
                <ClampedBlock label="the goals">
                  <ul className={styles.list}>
                    {spec.brief.goals.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </ClampedBlock>
              </>
            )}
            {spec.brief.locked && (
              <Tag size="sm" type="green">
                Brief locked. Drafting begins.
              </Tag>
            )}
          </div>

          {spec.document.length > 0 && (
            <div className={styles.document}>
              <h3 className={styles.blockTitle}>Requirements document</h3>
              {spec.document.map((b) => (
                <div key={b.heading}>
                  <h4 className={styles.small}>{b.heading}</h4>
                  <ClampedBlock label={b.heading.toLowerCase()}>
                    {b.lines.map((l) => (
                      <p key={l} className={styles.para}>
                        {l}
                      </p>
                    ))}
                  </ClampedBlock>
                </div>
              ))}
            </div>
          )}

          {published && (
            <div className={styles.ready}>
              <h3 className={styles.blockTitle}>Published {spec.publishedAt ? new Date(spec.publishedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</h3>
              <p className={styles.para}>
                {spec.preview.requirements} requirements and {spec.preview.openQuestions} open questions are on the board.
              </p>
              {!spec.standalone && (
                <Button kind="primary" size="md" onClick={p.onViewStories}>
                  View stories
                </Button>
              )}
              {!spec.standalone && spec.boardChanges === 0 && <p className={styles.muted}>The board matches this document.</p>}
            </div>
          )}
          {!p.canEdit && !published && <p className={styles.muted}>Editing is locked. Use &quot;Sign in&quot; or &quot;Unlock editing&quot; at the top of the page to review steps.</p>}
        </aside>
      </div>

      <Modal
        open={p.redoing !== null}
        size="sm"
        modalHeading={`Redo: ${p.redoing?.title ?? ''}`}
        primaryButtonText="Submit"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!p.redoText.trim() || p.busy}
        onRequestClose={p.onCancelRedo}
        onRequestSubmit={p.onSubmitRedo}
      >
        <p className={styles.para}>Tell the agent what to change about this step.</p>
        <TextArea id="redo-instructions" labelText="Instructions" rows={4} placeholder="e.g. Focus on the new-patient flow" value={p.redoText} onChange={(e) => p.onRedoText(e.target.value)} />
      </Modal>
      <Modal
        open={p.boardPlan !== null}
        size="sm"
        modalHeading="Update the board?"
        primaryButtonText="Update board"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={p.busy}
        onRequestClose={p.onCancelBoard}
        onRequestSubmit={p.onConfirmBoard}
      >
        {p.boardPlan && (
          <>
            <BoardChanges title="Added to To Do" items={p.boardPlan.add} />
            <BoardChanges title="Removed (nobody had touched them)" items={p.boardPlan.remove} />
            <BoardChanges title="Kept, with a note (they have been worked on)" items={p.boardPlan.flag} />
            <BoardChanges title="Note removed" items={p.boardPlan.clear} />
            <p className={styles.para}>Stories that have been moved, edited or given criteria are never removed.</p>
          </>
        )}
        {p.boardError && <InlineNotification kind="error" lowContrast hideCloseButton title="Board not updated" subtitle={p.boardError} />}
      </Modal>
      <Modal
        open={p.startOverOpen}
        danger
        size="sm"
        modalHeading="Start this document over?"
        primaryButtonText="Start over"
        secondaryButtonText="Cancel"
        onRequestClose={p.onCancelStartOver}
        onRequestSubmit={p.onConfirmStartOver}
      >
        <p>
          This discards the current document and drafts a new one from the project&apos;s current themes
          {published ? ', and removes the requirements and stories it created on the board' : ''}. It cannot be undone.
        </p>
        {p.startOverError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not started over" subtitle={p.startOverError} />}
      </Modal>
    </div>
  )
}

function BoardChanges({ title, items }: { title: string; items: BoardSyncPlan['add'] }) {
  if (!items.length) return null
  return (
    <section className={styles.changes}>
      <h4 className={styles.small}>{title}</h4>
      <ul className={styles.list}>
        {items.map((c) => (
          <li key={`${c.key}-${c.reason}`}>
            {c.key} · {c.title} ({c.reason.toLowerCase()})
          </li>
        ))}
      </ul>
    </section>
  )
}
