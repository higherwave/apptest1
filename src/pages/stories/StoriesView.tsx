import { Button, Dropdown, InlineNotification, Loading, Search, Tag, TextArea } from '@carbon/react'
import { useRef, useState } from 'react'
import { COLUMNS } from '../../../shared/board.mjs'
import { ChevronLeft, ChevronRight, Close } from '@carbon/icons-react'
import type { Board, BoardStory, ChecklistInput, Priority, ProjectDetail, StoryDetail, StoryStatus } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { STATUS_HINT, STATUS_LABEL } from './labels'
import styles from './StoriesView.module.scss'

const PRIORITY_LABEL: Record<Priority | 'all', string> = { all: 'All', high: 'High', medium: 'Medium', low: 'Low' }
// Themes beyond these go under a "more" menu so the filter row stays on one line.
const PRIORITIES: (Priority | 'all')[] = ['all', 'high', 'medium', 'low']

export type StoriesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  project?: ProjectDetail
  board?: Board
  stories: BoardStory[]
  canEdit: boolean
  moving: Set<string>
  search: string
  priority: Priority | 'all'
  openId: string | null
  detail?: StoryDetail
  detailBusy: boolean
  undoing: boolean
  saving: boolean
  /** When the last change was saved this session, for the status line. */
  savedAt?: string
  errorText?: string
  /** Said aloud to screen readers after a move, for example "R2 moved to In progress". */
  announcement?: string
  onSearch: (q: string) => void
  onPriority: (p: Priority | 'all') => void
  onOpen: (id: string) => void
  onMove: (story: BoardStory, status: StoryStatus, beforeId: string | null) => void
  onUndo: () => void
  onChecklist: (items: ChecklistInput[]) => void
  onGoRequirements: () => void
}

type RowProps = {
  story: BoardStory
  canEdit: boolean
  busy: boolean
  selected: boolean
  onOpen: (id: string) => void
  onMove: (story: BoardStory, status: StoryStatus) => void
}

// One story in the list: its key, title (opens the details), flags, priority, and previous and next stage buttons. The row can also be dragged
// onto a stage tile; the buttons are the way to do the same without a mouse.
function Row({ story, canEdit, busy, selected, onOpen, onMove }: RowProps) {
  const at = COLUMNS.indexOf(story.status)
  const prev: StoryStatus | undefined = COLUMNS[at - 1]
  const next: StoryStatus | undefined = COLUMNS[at + 1]
  return (
    <div
      className={styles.row}
      data-status={story.status}
      data-selected={selected}
      data-busy={busy}
      data-testid={`card-${story.key}`}
      draggable={canEdit && !busy}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', story.id)}
    >
      <span className={styles.grip} aria-hidden>
        ⋮⋮
      </span>
      <span className={styles.key}>{story.key}</span>
      <Button kind="ghost" size="sm" className={styles.open} aria-pressed={selected} onClick={() => onOpen(story.id)}>
        <span className={styles.title}>{story.title}</span>
      </Button>
      <span className={styles.flags}>
        {story.kind === 'open_question' && (
          <Tag size="sm" type="purple">
            Question
          </Tag>
        )}
        {story.syncNote && (
          <Tag size="sm" type="warm-gray" title={story.syncNote}>
            Out of step
          </Tag>
        )}
      </span>
      <span className={styles.priority} data-priority={story.priority}>
        {PRIORITY_LABEL[story.priority]}
      </span>
      <span className={styles.arrows}>
        {canEdit && (
          <>
            <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronLeft} iconDescription={prev ? `Move ${story.key} to ${STATUS_LABEL[prev]}` : `${story.key} is in the first stage`} tooltipPosition="left" data-testid={`prev-${story.key}`} disabled={busy || !prev} onClick={() => prev && onMove(story, prev)} />
            <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronRight} iconDescription={next ? `Move ${story.key} to ${STATUS_LABEL[next]}` : `${story.key} is in the last stage`} tooltipPosition="left" data-testid={`next-${story.key}`} disabled={busy || !next} onClick={() => next && onMove(story, next)} />
          </>
        )}
      </span>
    </div>
  )
}

type PanelProps = Pick<StoriesViewProps, 'canEdit' | 'onChecklist'> & {
  story: BoardStory
  detail?: StoryDetail
  busy: boolean
  onMove: (status: StoryStatus) => void
}

// The static panel on the right: whatever card is selected, with its status and acceptance criteria to edit. It is context to
// carry into a tracker such as Jira, so it holds no owner or priority.
function Panel({ story, detail, canEdit, busy, onChecklist, onMove }: PanelProps) {
  return (
    <div className={styles.panelBody}>
      <p className={styles.panelKicker}>
        {STATUS_LABEL[story.status]} · {story.theme?.title ?? 'No theme'}
      </p>
      <h2 className={styles.panelTitle}>
        {story.key} — {story.title}
      </h2>
      <div className={styles.tags}>
        <Tag size="md" type="outline">
          {STATUS_LABEL[story.status]}
        </Tag>
        {story.theme && (
          <Tag size="md" type="outline">
            {story.theme.title}
          </Tag>
        )}
        {story.kind === 'open_question' && (
          <Tag size="md" type="purple">
            Open question
          </Tag>
        )}
      </div>
      {!detail && <Loading small withOverlay={false} description="Loading the story" />}
      {detail && <Editable key={detail.id} detail={detail} canEdit={canEdit} busy={busy} onChecklist={onChecklist} onMove={onMove} />}
    </div>
  )
}

function Editable({ detail, canEdit, busy, onChecklist, onMove }: Pick<StoriesViewProps, 'canEdit' | 'onChecklist'> & { detail: StoryDetail; busy: boolean; onMove: (status: StoryStatus) => void }) {
  const stageAt = COLUMNS.indexOf(detail.status)
  const prevStage: StoryStatus | undefined = COLUMNS[stageAt - 1]
  const nextStage: StoryStatus | undefined = COLUMNS[stageAt + 1]
  const saved: ChecklistInput[] = detail.checklist.map((c) => ({ id: c.id, kind: c.kind, text: c.text, met: c.met }))
  // The rows on screen: the saved ones, plus any blank row just added (a blank row is never saved).
  const [rows, setRows] = useState<ChecklistInput[]>(saved)
  const [seen, setSeen] = useState(detail.checklist)
  if (seen !== detail.checklist) {
    setSeen(detail.checklist)
    setRows(saved)
  }
  const focusRow = useRef<number | null>(null)
  const commit = (next: ChecklistInput[]) => {
    const kept = next.filter((r) => r.text.trim()).map((r) => ({ ...r, text: r.text.trim() }))
    if (JSON.stringify(kept) !== JSON.stringify(saved)) onChecklist(kept)
  }
  const edit = (i: number, change: Partial<ChecklistInput>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...change } : r)))
  return (
    <>
      {detail.summary && <p className={styles.summary}>{detail.summary}</p>}
      <div className={styles.facts}>
        {detail.theme && (
          <div className={styles.fact}>
            <span className={styles.factLabel}>Raised by</span>
            <span className={styles.factValue}>
              {detail.theme.participantCount} of {detail.theme.totalParticipants} participants
            </span>
          </div>
        )}
      </div>

      {detail.syncNote && <InlineNotification kind="warning" lowContrast hideCloseButton title="Out of step with the document" subtitle={detail.syncNote} />}

      {(detail.whyItMatters || detail.nextStep) && (
        <div className={styles.note}>
          {detail.whyItMatters && (
            <>
              <h3 className={styles.noteHead}>Why it matters</h3>
              <p className={styles.noteText}>{detail.whyItMatters}</p>
            </>
          )}
          {detail.nextStep && (
            <>
              <h3 className={styles.noteHead}>Next step</h3>
              <p className={styles.noteText}>{detail.nextStep}</p>
            </>
          )}
        </div>
      )}

      <div className={styles.nav}>
        <div className={styles.navButtons}>
          <Button kind="secondary" size="md" disabled={!canEdit || busy || !prevStage} onClick={() => prevStage && onMove(prevStage)}>
            {prevStage ? `‹ ${STATUS_LABEL[prevStage]}` : 'Back'}
          </Button>
          <Button kind="primary" size="md" disabled={!canEdit || busy || !nextStage} onClick={() => nextStage && onMove(nextStage)}>
            {nextStage ? `${STATUS_LABEL[nextStage]} ›` : 'Done'}
          </Button>
        </div>
        {/* A demo of the hand-off: it will open a Create ticket dialog once Jira is connected. */}
        <Button className={styles.jira} kind="ghost" size="sm">
          Create Jira Ticket
        </Button>
      </div>

      <h3 className={styles.sub}>Acceptance criteria</h3>
      {rows.length === 0 && <p className={styles.noteText}>No acceptance criteria yet.</p>}
      <ul className={styles.list}>
        {rows.map((r, i) => (
          <li key={r.id ?? `new-${i}`} className={styles.item}>
            <TextArea
              id={`criterion-${i}`}
              labelText={`Criterion ${i + 1}`}
              hideLabel
              rows={2}
              placeholder="Describe what must be true"
              readOnly={!canEdit}
              value={r.text}
              ref={(el: HTMLTextAreaElement | null) => {
                if (el && focusRow.current === i) {
                  focusRow.current = null
                  el.focus()
                }
              }}
              onChange={(e) => edit(i, { text: e.target.value })}
              onBlur={() => commit(rows)}
            />
            {canEdit && (
              <Button
                kind="ghost"
                size="sm"
                hasIconOnly
                renderIcon={Close}
                iconDescription={`Remove criterion ${i + 1}`}
                tooltipPosition="left"
                disabled={busy}
                onClick={() => {
                  const next = rows.filter((_, j) => j !== i)
                  setRows(next)
                  commit(next)
                }}
              />
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <Button
          className={styles.addLink}
          kind="ghost"
          size="sm"
          disabled={busy || rows.some((r) => !r.text.trim())}
          onClick={() => {
            focusRow.current = rows.length
            setRows([...rows, { kind: 'criterion', text: '', met: false }])
          }}
        >
          + Add criterion
        </Button>
      )}

    </>
  )
}

// Presentational: the stories as a pipeline. Four stage tiles with counts sit above the list of the chosen stage and a panel for the selected
// story. A story moves by dragging its row onto a tile, with the buttons on its row, or with the buttons in the panel.
export function StoriesView(props: StoriesViewProps) {
  const { state, board, stories, canEdit, moving, search, priority, openId, detail, detailBusy, undoing, saving, savedAt, errorText, announcement } = props
  const [stage, setStage] = useState<StoryStatus>('todo')
  const [over, setOver] = useState<StoryStatus | null>(null)
  const byId = (id: string) => board?.stories.find((s) => s.id === id)
  const inStage = (status: StoryStatus) => stories.filter((s) => s.status === status).sort((a, b) => a.position - b.position)
  const opened = openId ? byId(openId) : undefined
  const inProgress = board?.stories.filter((s) => s.status === 'in_progress').length ?? 0
  const list = inStage(stage)
  const choose = (status: StoryStatus) => {
    setStage(status)
    const first = inStage(status)[0]
    if (first && opened?.status !== status) props.onOpen(first.id)
  }
  const move = (story: BoardStory, status: StoryStatus) => {
    props.onMove(story, status, null)
    // The row leaves this list, so keyboard focus goes to the stage that is showing.
    requestAnimationFrame(() => document.getElementById(`stage-${stage}`)?.focus())
  }
  const drop = (e: React.DragEvent, status: StoryStatus) => {
    e.preventDefault()
    setOver(null)
    const story = byId(e.dataTransfer.getData('text/plain'))
    if (story && story.status !== status) props.onMove(story, status, null)
  }

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <ProjectHeader
          title="Stories"
          description={
            board
              ? `${board.stories.length} ${board.stories.length === 1 ? 'story' : 'stories'} from the requirements document. ${inProgress} in progress; open questions need a scope decision.`
              : 'Each story is a requirement or an open question from the published document.'
          }
        />
        {state === 'ready' && (
          <p className={styles.saved} role="status">
            <span className={styles.savedDot} data-saving={saving} aria-hidden />
            {saving ? 'Saving…' : savedAt ? `All changes saved at ${savedAt}` : 'All changes saved'}
          </p>
        )}
      </div>
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading withOverlay={false} description="Loading the board" />}
      {state === 'error' && !errorText && <p className={styles.empty}>The board could not be loaded.</p>}
      {state === 'empty' && (
        <div className={styles.emptyState}>
          <p className={styles.empty}>Publish a requirements document to put its stories on the board.</p>
          <Button kind="primary" size="md" onClick={props.onGoRequirements}>
            Go to Requirements
          </Button>
        </div>
      )}
      {state === 'ready' && board && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.search}>
              <Search id="story-search" size="md" labelText="Search stories" placeholder="Search requirements, themes, owners" value={search} onChange={(e: { target: { value: string } }) => props.onSearch(e.target.value)} onClear={() => props.onSearch('')} />
            </div>
            <div className={styles.priorityFilter}>
              <span className={styles.filterLabel}>Priority</span>
              <Dropdown
                id="story-filter-priority"
                titleText="Priority filter"
                hideLabel
                label="Priority"
                items={PRIORITIES}
                itemToString={(p: Priority | 'all' | null) => (p ? PRIORITY_LABEL[p] : '')}
                selectedItem={priority}
                onChange={({ selectedItem }: { selectedItem: Priority | 'all' | null | undefined }) => props.onPriority(selectedItem ?? 'all')}
              />
            </div>
            {canEdit && board.lastMove && (
              <Button kind="secondary" size="md" disabled={undoing} onClick={props.onUndo}>
                Undo move of {board.lastMove.key}
              </Button>
            )}
          </div>
          <div className={styles.stages} role="group" aria-label="Stages">
            {COLUMNS.map((status: StoryStatus) => (
              <Button
                key={status}
                id={`stage-${status}`}
                kind="ghost"
                className={styles.stage}
                data-status={status}
                data-over={over === status}
                aria-pressed={stage === status}
                aria-label={`${STATUS_LABEL[status]}, ${inStage(status).length} ${inStage(status).length === 1 ? 'story' : 'stories'}`}
                onClick={() => choose(status)}
                onDragOver={(e: React.DragEvent) => {
                  e.preventDefault()
                  if (over !== status) setOver(status)
                }}
                onDragLeave={() => setOver(null)}
                onDrop={(e: React.DragEvent) => drop(e, status)}
              >
                <span className={styles.stageName}>
                  <span className={styles.dot} aria-hidden />
                  {STATUS_LABEL[status]}
                </span>
                <span className={styles.stageCount}>{inStage(status).length}</span>
              </Button>
            ))}
          </div>
          <p className={styles.hint}>{STATUS_HINT[stage]}</p>
          <div className={styles.layout}>
            <section className={styles.list} aria-label={STATUS_LABEL[stage]}>
              {list.map((s) => (
                <Row key={s.id} story={s} canEdit={canEdit} busy={moving.has(s.id)} selected={openId === s.id} onOpen={props.onOpen} onMove={move} />
              ))}
              {list.length === 0 && <p className={styles.none}>Nothing here under the current filters.</p>}
            </section>
            <aside className={styles.panel} aria-label="Story details">
              {opened ? (
                <Panel
                  key={opened.id}
                  story={opened}
                  detail={detail && detail.id === opened.id ? detail : undefined}
                  canEdit={canEdit}
                  busy={detailBusy}
                  onChecklist={props.onChecklist}
                  onMove={(status) => props.onMove(opened, status, null)}
                />
              ) : (
                <p className={styles.none}>Select a story to see its details.</p>
              )}
            </aside>
          </div>
        </>
      )}
      <p className={styles.visuallyHidden} role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  )
}
