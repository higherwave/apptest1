import { Button, InlineNotification, Loading, Modal, Tag, TextArea } from '@carbon/react'
import type { SpecDetail, SpecStep } from '../../api/client'
import { CATEGORY_LABEL } from '../themes/themeEdits'
import { StepCard } from './StepCard'
import styles from './WriterView.module.scss'

export type WriterViewProps = {
  state: 'loading' | 'error' | 'ready'
  spec?: SpecDetail
  canEdit: boolean
  busy: boolean
  errorText?: string
  notice?: string
  freshStepId: string | null
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
  onRedo: (step: SpecStep) => void
  onRedoText: (text: string) => void
  onSubmitRedo: () => void
  onCancelRedo: () => void
  onPublish: () => void
  onViewStories: () => void
  onBack: () => void
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
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the document" />
  if (state === 'error' || !spec) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Requirements" subtitle={p.errorText} />
  const published = spec.status === 'published'
  const locked = !p.canEdit || published

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
          <h2 className={styles.label}>Themes used</h2>
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
          {!published && <p className={styles.help}>Click a theme to exclude it. Changes apply to steps that have not started yet.</p>}
        </section>
      )}

      <div className={styles.columns}>
        <section className={styles.steps} aria-label="Agent reasoning">
          <h2 className={styles.label}>Agent reasoning</h2>
          {spec.steps.map((step) => (
            <StepCard
              key={step.id}
              step={step}
              canEdit={p.canEdit}
              published={published}
              busy={p.busy}
              fresh={p.freshStepId === step.id}
              editing={p.editingId === step.id}
              draft={p.draft}
              onDraft={p.onDraft}
              onEditStart={() => p.onEditStart(step)}
              onEditSave={p.onEditSave}
              onEditCancel={p.onEditCancel}
              onApprove={() => p.onApprove(step)}
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
                <p className={styles.para}>{spec.brief.problem}</p>
              </>
            )}
            {spec.brief.users && (
              <>
                <h4 className={styles.small}>Users</h4>
                <p className={styles.para}>{spec.brief.users}</p>
              </>
            )}
            {spec.brief.goals && (
              <>
                <h4 className={styles.small}>Goals</h4>
                <ul className={styles.list}>
                  {spec.brief.goals.map((g) => (
                    <li key={g}>{g}</li>
                  ))}
                </ul>
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
                  {b.lines.map((l) => (
                    <p key={l} className={styles.para}>
                      {l}
                    </p>
                  ))}
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
            </div>
          )}
          {spec.canPublish && p.canEdit && (
            <div className={styles.ready}>
              <h3 className={styles.blockTitle}>Ready to publish</h3>
              <p className={styles.para}>
                {spec.standalone
                  ? 'Every step is approved. Publishing marks this document final.'
                  : `Every step is approved. Publishing creates ${spec.preview.requirements} requirements and ${spec.preview.openQuestions} open questions on the Stories board, all in To Do.`}
              </p>
              <Button kind="primary" size="md" disabled={p.busy} onClick={p.onPublish}>
                Publish
              </Button>
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
