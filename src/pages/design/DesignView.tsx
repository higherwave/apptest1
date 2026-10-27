import { ChevronDown, ChevronUp, Link as LinkIcon } from '@carbon/icons-react'
import { Button, FileUploaderDropContainer, InlineNotification, Loading, Modal, Tag, TextArea, TextInput } from '@carbon/react'
import { useRef, useState } from 'react'
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

// One requirement as an accordion item. The heading row is the requirement's title with what has been done so far; opened, it shows
// the research behind it, then the prototype (link and thumbnail) on the left and the design notes on the right. The link and the
// notes save when the field is left, if they changed; a picture saves as soon as it is chosen.
function Row({ item, canEdit, open, onToggle, onSave }: { item: DesignItem; canEdit: boolean; open: boolean; onToggle: () => void; onSave: DesignViewProps['onSave'] }) {
  return (
    <li className={styles.item} data-testid={`design-${item.key}`} data-open={open}>
      <h3 className={styles.itemHead}>
        <Button
          kind="ghost"
          size="md"
          className={styles.headButton}
          renderIcon={open ? ChevronUp : ChevronDown}
          aria-expanded={open}
          aria-controls={`design-body-${item.key}`}
          onClick={onToggle}
        >
          <span className={styles.headText}>
            <span className={styles.reqTitle}>
              {item.key} — {item.title}
            </span>
            <span className={styles.status}>
              <Tag size="sm" type={item.prototypeUrl || item.hasImage ? 'green' : 'gray'}>
                {item.prototypeUrl || item.hasImage ? 'Prototype' : 'No prototype'}
              </Tag>
              <Tag size="sm" type={item.notes ? 'green' : 'gray'}>
                {item.notes ? 'Notes' : 'No notes'}
              </Tag>
            </span>
          </span>
        </Button>
      </h3>
      {open && <RowBody item={item} canEdit={canEdit} onSave={onSave} />}
    </li>
  )
}

const LINK_OK = /^https?:\/\/\S+$/i
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function RowBody({ item, canEdit, onSave }: { item: DesignItem; canEdit: boolean; onSave: DesignViewProps['onSave'] }) {
  const [notes, setNotes] = useState(item.notes ?? '')
  const [pictureError, setPictureError] = useState<string | undefined>()
  const [linkOpen, setLinkOpen] = useState(false)
  const [link, setLink] = useState('')
  const [dragging, setDragging] = useState(false)
  const picker = useRef<HTMLButtonElement>(null)
  const clean = (v: string) => (v.trim() === '' ? null : v.trim())
  const body = (extra: Partial<DesignRequest> = {}): DesignRequest => ({ prototypeUrl: item.prototypeUrl, notes: clean(notes), ...extra })
  const commitNotes = () => {
    if (clean(notes) !== item.notes) void onSave(item.storyId, body())
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
  const openLink = () => {
    setLink(item.prototypeUrl ?? '')
    setLinkOpen(true)
  }
  const linkValid = LINK_OK.test(link.trim())
  const saveLink = () => {
    if (!linkValid) return
    setLinkOpen(false)
    void onSave(item.storyId, body({ prototypeUrl: link.trim() }))
  }
  const hasLink = !!item.prototypeUrl
  const upload = () => picker.current?.click()
  const picture = item.hasImage ? <img className={styles.thumb} src={designImageUrl(item.storyId, item.version)} alt={`Prototype of ${item.key}: ${item.title}`} /> : null
  const open = (child: React.ReactNode) => (
    <a className={styles.frameLink} href={item.prototypeUrl ?? undefined} target="_blank" rel="noopener noreferrer" aria-label={`Open the prototype of ${item.key} in a new tab`}>
      {child}
    </a>
  )

  return (
    <div id={`design-body-${item.key}`} className={styles.itemBody}>
      <div className={styles.context}>
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

      <div className={styles.split}>
        <div className={styles.cell}>
          <h4 className={styles.colHead}>Prototype</h4>
          <div
            className={styles.frame}
            data-frame
            data-filled={item.hasImage || hasLink}
            data-dragging={dragging}
            onDragOver={canEdit ? (e) => { e.preventDefault(); setDragging(true) } : undefined}
            onDragLeave={canEdit ? () => setDragging(false) : undefined}
            onDrop={canEdit ? (e) => { e.preventDefault(); setDragging(false); void choose([...e.dataTransfer.files]) } : undefined}
          >
            {item.hasImage && (hasLink ? open(picture) : picture)}
            {!item.hasImage && hasLink && open(
              <span className={styles.linkTile}>
                <LinkIcon size={32} aria-hidden />
                <span>{hostOf(item.prototypeUrl!)}</span>
              </span>,
            )}
            {!item.hasImage && !hasLink && (
              <div className={styles.empty}>
                <p className={styles.emptyText}>{canEdit ? 'Add the prototype' : 'No prototype yet'}</p>
                {canEdit && <p className={styles.emptyHint}>Upload a screenshot, link the prototype, or both. You can also drop an image here.</p>}
              </div>
            )}
            {canEdit && (
              <div className={styles.actions} data-empty={!item.hasImage && !hasLink}>
                <Button kind={item.hasImage || hasLink ? 'secondary' : 'primary'} size="sm" onClick={upload}>
                  {item.hasImage ? 'Replace screenshot' : 'Upload screenshot'}
                </Button>
                <Button kind="secondary" size="sm" onClick={openLink}>
                  {hasLink ? 'Edit link' : 'Link prototype'}
                </Button>
                {item.hasImage && (
                  <Button kind="ghost" size="sm" onClick={() => void onSave(item.storyId, body({ image: null }))}>
                    Remove screenshot
                  </Button>
                )}
              </div>
            )}
          </div>
          {hasLink && (
            <a className={styles.open} href={item.prototypeUrl!} target="_blank" rel="noopener noreferrer">
              Open prototype ↗ <span className={styles.muted}>{hostOf(item.prototypeUrl!)}</span>
            </a>
          )}
          {pictureError && <p className={styles.error}>{pictureError}</p>}
          {canEdit && (
            <div className={styles.hiddenPicker}>
              <FileUploaderDropContainer
                innerRef={picker}
                accept={['image/png', 'image/jpeg', 'image/webp']}
                labelText={`Choose a screenshot for ${item.key}`}
                onAddFiles={(_, { addedFiles }) => void choose(addedFiles)}
              />
            </div>
          )}
        </div>

        <div className={`${styles.cell} ${styles.notesCell}`}>
          <h4 className={styles.colHead}>Design notes</h4>
          {canEdit ? (
            <TextArea
              id={`design-notes-${item.key}`}
              labelText={`Design notes for ${item.key}`}
              hideLabel
              rows={10}
              placeholder="Alternatives explored, and why this direction"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={commitNotes}
            />
          ) : (
            <p className={styles.notes}>{item.notes ?? 'No design notes yet.'}</p>
          )}
        </div>
      </div>

      <Modal
        open={linkOpen}
        size="sm"
        modalHeading={hasLink ? `Edit the prototype link for ${item.key}` : `Link the prototype for ${item.key}`}
        primaryButtonText="Save link"
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!linkValid}
        onRequestClose={() => setLinkOpen(false)}
        onRequestSubmit={saveLink}
      >
        <TextInput
          id={`design-link-${item.key}`}
          labelText="Prototype link"
          placeholder="https://"
          value={link}
          invalid={link.trim() !== '' && !linkValid}
          invalidText="Enter a link that starts with http:// or https://."
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') saveLink()
          }}
        />
        {hasLink && (
          <Button
            kind="ghost"
            size="sm"
            className={styles.removeLink}
            onClick={() => {
              setLinkOpen(false)
              void onSave(item.storyId, body({ prototypeUrl: null }))
            }}
          >
            Remove link
          </Button>
        )}
      </Modal>
    </div>
  )
}

// Presentational: the requirements of the published document as a table of requirement, prototype and design notes.
export function DesignView(props: DesignViewProps) {
  const { state, design, canEdit, saving, savedAt, errorText } = props
  const [decisionsOpen, setDecisionsOpen] = useState(false)
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const toggle = (id: string) => setOpened((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
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
            <>
              <div className={styles.listTools}>
                <Button kind="ghost" size="sm" onClick={() => setOpened(opened.size === design.items.length ? new Set() : new Set(design.items.map((i) => i.storyId)))}>
                  {opened.size === design.items.length ? 'Collapse all' : 'Expand all'}
                </Button>
              </div>
              <ul className={styles.list} aria-label="Requirements and their prototypes">
                {design.items.map((item) => (
                  <Row key={item.storyId} item={item} canEdit={canEdit} open={opened.has(item.storyId)} onToggle={() => toggle(item.storyId)} onSave={props.onSave} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
