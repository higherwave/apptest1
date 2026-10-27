import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, FileUploaderDropContainer, InlineNotification, Loading, Tag, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import { designImageUrl, type Design, type DesignItem, type DesignRequest } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { ClampedBlock } from '../requirements/ClampedBlock'
import { makeThumbnail } from './image'
import styles from './DesignView.module.scss'

export type DesignViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  design?: Design
  canEdit: boolean
  saving: boolean
  savedAt?: string
  errorText?: string
  onSave: (storyId: string, body: DesignRequest) => Promise<unknown>
  onGoRequirements: () => void
}

const PRIORITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const

// One row: the requirement and the research behind it, its prototype (link and thumbnail), and the design notes. The link and the
// notes save when the field is left, if they changed; a picture saves as soon as it is chosen.
function Row({ item, canEdit, onSave }: { item: DesignItem; canEdit: boolean; onSave: DesignViewProps['onSave'] }) {
  const [url, setUrl] = useState(item.prototypeUrl ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [pictureError, setPictureError] = useState<string | undefined>()
  const clean = (v: string) => (v.trim() === '' ? null : v.trim())
  const body = (extra: Partial<DesignRequest> = {}): DesignRequest => ({ prototypeUrl: clean(url), notes: clean(notes), ...extra })
  const dirty = clean(url) !== item.prototypeUrl || clean(notes) !== item.notes
  const commit = () => {
    if (dirty) void onSave(item.storyId, body())
  }
  const choose = async (files: File[]) => {
    setPictureError(undefined)
    const file = files[0]
    if (!file) return
    try {
      const picture = await makeThumbnail(file)
      await onSave(item.storyId, body({ image: picture }))
    } catch (err) {
      setPictureError(err instanceof Error ? err.message : 'The picture could not be added.')
    }
  }
  const picture = item.hasImage ? (
    <img className={styles.thumb} src={designImageUrl(item.storyId, item.version)} alt={`Prototype of ${item.key}: ${item.title}`} />
  ) : (
    <div className={styles.noThumb}>No picture yet</div>
  )

  return (
    <div className={styles.row} role="row" data-testid={`design-${item.key}`}>
      <div className={styles.cell} role="cell">
        <h3 className={styles.reqTitle}>
          {item.key} — {item.title}
        </h3>
        <div className={styles.meta}>
          {item.theme && (
            <Tag size="sm" type="gray" title={item.theme.title}>
              {item.theme.title}
            </Tag>
          )}
          <span className={styles.muted}>
            {item.theme ? `${item.theme.participantCount} of ${item.theme.totalParticipants} participants · ` : ''}
            {PRIORITY_LABEL[item.priority]} priority
          </span>
        </div>
        {(item.whyItMatters ?? item.summary) && (
          <ClampedBlock label={`why ${item.key} matters`}>
            <p className={styles.why}>{item.whyItMatters ?? item.summary}</p>
          </ClampedBlock>
        )}
      </div>

      <div className={styles.cell} role="cell">
        {item.prototypeUrl ? (
          <a className={styles.thumbLink} href={item.prototypeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open the prototype of ${item.key} in a new tab`}>
            {picture}
          </a>
        ) : (
          picture
        )}
        {item.prototypeUrl && (
          <a className={styles.open} href={item.prototypeUrl} target="_blank" rel="noopener noreferrer">
            Open prototype ↗
          </a>
        )}
        {canEdit && (
          <>
            <TextInput
              id={`design-url-${item.key}`}
              size="sm"
              labelText={`Prototype link for ${item.key}`}
              hideLabel
              placeholder="Paste the prototype link"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onBlur={commit}
            />
            <div className={styles.drop}>
              <FileUploaderDropContainer
                accept={['image/png', 'image/jpeg', 'image/webp']}
                labelText={item.hasImage ? 'Drop a new picture or click' : 'Drop a screenshot or click'}
                onAddFiles={(_, { addedFiles }) => void choose(addedFiles)}
              />
            </div>
            {item.hasImage && (
              <Button kind="ghost" size="sm" onClick={() => void onSave(item.storyId, body({ image: null }))}>
                Remove picture
              </Button>
            )}
            {pictureError && <p className={styles.error}>{pictureError}</p>}
          </>
        )}
      </div>

      <div className={`${styles.cell} ${styles.notesCell}`} role="cell">
        {canEdit ? (
          <TextArea
            id={`design-notes-${item.key}`}
            labelText={`Design notes for ${item.key}`}
            hideLabel
            rows={6}
            placeholder="Alternatives explored, and why this direction"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={commit}
          />
        ) : (
          <p className={styles.notes}>{item.notes ?? 'No design notes yet.'}</p>
        )}
      </div>
    </div>
  )
}

// Presentational: the requirements of the published document as a table of requirement, prototype and design notes.
export function DesignView(props: DesignViewProps) {
  const { state, design, canEdit, saving, savedAt, errorText } = props
  const [decisionsOpen, setDecisionsOpen] = useState(false)
  const decisions = design?.decisions
  const hasDecisions = !!decisions && (!!decisions.reasoning || decisions.alternatives.length > 0)
  const withPrototype = design?.items.filter((i) => i.prototypeUrl).length ?? 0

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <ProjectHeader
          title="Design"
          description={
            design
              ? `${design.items.length} ${design.items.length === 1 ? 'requirement' : 'requirements'}, ${withPrototype} with a prototype. Link each one to its prototype and note the decisions behind it.`
              : 'Each requirement of the published document, with its prototype and the design decisions behind it.'
          }
        />
        {state === 'ready' && canEdit && (
          <p className={styles.saved} role="status">
            <span className={styles.savedDot} data-saving={saving} aria-hidden />
            {saving ? 'Saving…' : savedAt ? `All changes saved at ${savedAt}` : 'All changes saved'}
          </p>
        )}
      </div>
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading the design table" />}
      {state === 'error' && !errorText && <p className={styles.muted}>The design table could not be loaded.</p>}
      {state === 'empty' && (
        <div className={styles.emptyState}>
          <p className={styles.muted}>Publish a requirements document to put its requirements here.</p>
          <Button kind="primary" size="md" onClick={props.onGoRequirements}>
            Go to Requirements
          </Button>
        </div>
      )}
      {state === 'ready' && design && (
        <>
          {hasDecisions && (
            <section className={styles.decisions} aria-label="Decisions from the requirements">
              <div className={styles.decisionsHead}>
                <h2 className={styles.label}>Decisions from the requirements</h2>
                <Button
                  kind="ghost"
                  size="sm"
                  renderIcon={decisionsOpen ? ChevronUp : ChevronDown}
                  aria-expanded={decisionsOpen}
                  aria-controls="design-decisions"
                  onClick={() => setDecisionsOpen((o) => !o)}
                >
                  {decisionsOpen ? 'Hide' : `Show${decisions.alternatives.length ? ` (${decisions.alternatives.length} considered and rejected)` : ''}`}
                </Button>
              </div>
              {decisionsOpen && (
                <div id="design-decisions" className={styles.decisionsBody}>
                  {decisions.reasoning && <p className={styles.why}>{decisions.reasoning}</p>}
                  {decisions.alternatives.length > 0 && (
                    <>
                      <h3 className={styles.sub}>Considered and rejected</h3>
                      {decisions.alternatives.map((a) => (
                        <p key={a.title} className={styles.why}>
                          <span className={styles.struck}>{a.title}</span> {a.reason}
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {design.items.length === 0 ? (
            <p className={styles.muted}>This document has no requirements, only open questions, so there is nothing to design yet.</p>
          ) : (
            <div className={styles.table} role="table" aria-label="Requirements and their prototypes">
              <div className={styles.headRow} role="row">
                <div className={styles.colHead} role="columnheader">
                  Requirement
                </div>
                <div className={styles.colHead} role="columnheader">
                  Prototype
                </div>
                <div className={styles.colHead} role="columnheader">
                  Design notes
                </div>
              </div>
              {design.items.map((item) => (
                <Row key={item.storyId} item={item} canEdit={canEdit} onSave={props.onSave} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
