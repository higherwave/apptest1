import { Button, Dropdown, InlineNotification, Loading, OverflowMenu, OverflowMenuItem, Search, Tag, TextArea } from '@carbon/react'
import { useEffect, useRef, useState } from 'react'
import { COLUMNS } from '../../../shared/board.mjs'
import { ChevronDown, ChevronUp, Close } from '@carbon/icons-react'
import type { Board, BoardStory, ChecklistInput, Priority, ProjectDetail, StoryDetail, StoryStatus } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { STATUS_HINT, STATUS_LABEL } from './labels'
import styles from './StoriesView.module.scss'

const PRIORITY_LABEL: Record<Priority | 'all', string> = { all: 'All', high: 'High', medium: 'Medium', low: 'Low' }
// Themes beyond these go under a "more" menu so the filter row stays on one line.
const PRIORITIES: (Priority | 'all')[] = ['all', 'high', 'medium', 'low']
// A stage lists this many cards, then offers the rest. Searching or filtering lists every match.
const CARDS_PER_STAGE = 10

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

type CardProps = {
  story: BoardStory
  canEdit: boolean
  busy: boolean
  over: boolean
  selected: boolean
  /** Open shows the theme, owner, progress and priority; closed shows the title only. */
  expanded: boolean
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  onMove: (story: BoardStory, status: StoryStatus, beforeId: string | null) => void
  onDragOver: (id: string) => void
  onDrop: (e: React.DragEvent) => void
}

function Card({ story, canEdit, busy, over, selected, expanded, onToggle, onOpen, onMove, onDragOver, onDrop }: CardProps) {
  return (
    <article
      className={styles.card}
      data-status={story.status}
      data-over={over}
      data-busy={busy}
      data-selected={selected}
      data-testid={`card-${story.key}`}
      draggable={canEdit && !busy}
      onDragStart={(e) => e.dataTransfer.setData('text/plain', story.id)}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDragOver(story.id)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDrop(e)
      }}
    >
      <div className={styles.cardHead}>
        <Button kind="ghost" size="sm" className={styles.open} aria-pressed={selected} onClick={() => onOpen(story.id)}>
          <span className={styles.title} data-expanded={expanded}>
            {story.key} — {story.title}
          </span>
        </Button>
        <Button
          kind="ghost"
          size="sm"
          hasIconOnly
          renderIcon={expanded ? ChevronUp : ChevronDown}
          iconDescription={expanded ? `Collapse ${story.key}` : `Expand ${story.key}`}
          tooltipPosition="left"
          aria-expanded={expanded}
          onClick={() => onToggle(story.id)}
        />
      </div>
      {story.syncNote && (
        <Tag className={styles.themeTag} size="sm" type="warm-gray" title={story.syncNote}>
          Out of step
        </Tag>
      )}
      {expanded && (
        <>
          {story.kind === 'open_question' && (
            <Tag className={styles.themeTag} size="sm" type="purple">
              Question
            </Tag>
          )}
          {story.theme && (
            <Tag className={styles.themeTag} size="sm" type="gray" title={story.theme.title}>
              {story.theme.title}
            </Tag>
          )}
          {(story.ownerTeam || story.criteriaTotal > 0) && (
            <p className={styles.progress}>
              {[story.ownerTeam, story.criteriaTotal > 0 ? `${story.criteriaMet} of ${story.criteriaTotal} criteria met` : null].filter(Boolean).join(' · ')}
            </p>
          )}
          <div className={styles.cardFoot}>
            <p className={styles.priority} data-priority={story.priority}>
              {PRIORITY_LABEL[story.priority]} priority
            </p>
            {canEdit && (
              <OverflowMenu iconDescription={`Move ${story.key}`} flipped size="sm">
                {COLUMNS.filter((c: StoryStatus) => c !== story.status).map((c: StoryStatus) => (
                  <OverflowMenuItem key={c} itemText={`Move to ${STATUS_LABEL[c]}`} onClick={() => onMove(story, c, null)} />
                ))}
              </OverflowMenu>
            )}
          </div>
        </>
      )}
    </article>
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

// Presentational: the four-column board with filters, drag and a "Move to" alternative, Undo, and a static panel for the selected card.
export function StoriesView(props: StoriesViewProps) {
  const { state, board, stories, canEdit, moving, search, priority, openId, detail, detailBusy, undoing, saving, savedAt, errorText, announcement } = props
  const [drag, setDrag] = useState<{ column: StoryStatus; before: string | null } | null>(null)
  // Cards start folded to their title; these are the ones opened, and the stages that list every card instead of the first few.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [listAll, setListAll] = useState<Set<StoryStatus>>(new Set())
  const [lastMovedId, setLastMovedId] = useState<string | null>(null)
  const toggleCard = (id: string) => setExpanded((e) => { const n = new Set(e); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const toggleStage = (status: StoryStatus) => setListAll((l) => { const n = new Set(l); if (n.has(status)) n.delete(status); else n.add(status); return n })
  const filtering = search.trim() !== '' || priority !== 'all'
  const allOpen = stories.length > 0 && stories.every((s) => expanded.has(s.id))
  const byId = (id: string) => board?.stories.find((s) => s.id === id)
  const drop = (e: React.DragEvent, status: StoryStatus, beforeId: string | null) => {
    e.preventDefault()
    setDrag(null)
    const story = byId(e.dataTransfer.getData('text/plain'))
    if (story && story.id !== beforeId) move(story, status, beforeId)
  }
  const opened = openId ? byId(openId) : undefined
  // A card that moves is re-created in its new column, so keyboard focus follows it there.
  const followKey = useRef<string | null>(null)
  const move = (story: BoardStory, status: StoryStatus, beforeId: string | null) => {
    followKey.current = story.key
    setLastMovedId(story.id)
    props.onMove(story, status, beforeId)
  }
  useEffect(() => {
    const key = followKey.current
    const open = key ? document.querySelector<HTMLElement>(`[data-testid="card-${key}"] button`) : null
    if (key && open && open !== document.activeElement && stories.find((s) => s.key === key)) {
      followKey.current = null
      open.focus()
    }
  }, [stories])
  const inProgress = board?.stories.filter((s) => s.status === 'in_progress').length ?? 0

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <ProjectHeader
          title="Stories"
          description={
            board
              ? `${board.stories.length} ${board.stories.length === 1 ? 'story' : 'stories'} from the requirements document. ${inProgress} in progress; open questions need a scope decision.`
              : 'Each card is a requirement or an open question from the published document.'
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
            <Button kind="ghost" size="md" disabled={stories.length === 0} onClick={() => setExpanded(allOpen ? new Set() : new Set(stories.map((s) => s.id)))}>
              {allOpen ? 'Collapse all cards' : 'Expand all cards'}
            </Button>
            {canEdit && board.lastMove && (
              <Button kind="secondary" size="md" disabled={undoing} onClick={props.onUndo}>
                Undo move of {board.lastMove.key}
              </Button>
            )}
          </div>
          <div className={styles.layout}>
            <div className={styles.board}>
              {COLUMNS.map((status: StoryStatus) => {
                const cards = stories.filter((s) => s.status === status).sort((a, b) => a.position - b.position)
                // The card open in the panel and the one just moved are always listed, even past the first few.
                const everyCard = filtering || listAll.has(status) || cards.length <= CARDS_PER_STAGE
                const listed = everyCard ? cards : cards.filter((s, i) => i < CARDS_PER_STAGE || s.id === openId || s.id === lastMovedId)
                return (
                  <section
                    key={status}
                    className={styles.column}
                    data-status={status}
                    data-over={drag?.column === status && drag.before === null}
                    aria-label={STATUS_LABEL[status]}
                    onDragOver={(e) => {
                      e.preventDefault()
                      if (drag?.column !== status || drag.before !== null) setDrag({ column: status, before: null })
                    }}
                    onDragLeave={() => setDrag(null)}
                    onDrop={(e) => drop(e, status, null)}
                  >
                    <h2 className={styles.columnHead} title={STATUS_HINT[status]}>
                      {STATUS_LABEL[status]} <span className={styles.count}>{cards.length}</span>
                    </h2>
                    <div className={styles.cards}>
                    {listed.map((s) => (
                      <div key={s.id}>
                        <Card
                          story={s}
                          canEdit={canEdit}
                          busy={moving.has(s.id)}
                          over={drag?.column === status && drag.before === s.id}
                          selected={openId === s.id}
                          expanded={expanded.has(s.id)}
                          onToggle={toggleCard}
                          onOpen={props.onOpen}
                          onMove={move}
                          onDragOver={(id) => (drag?.column !== status || drag.before !== id) && setDrag({ column: status, before: id })}
                          onDrop={(e) => drop(e, status, s.id)}
                        />
                      </div>
                    ))}
                    {cards.length === 0 && <p className={styles.none}>Nothing here under the current filters.</p>}
                    {!filtering && cards.length > CARDS_PER_STAGE && (
                      <Button kind="ghost" size="sm" aria-expanded={listAll.has(status)} onClick={() => toggleStage(status)}>
                        {listAll.has(status) ? `Show first ${CARDS_PER_STAGE} only` : `Show ${cards.length - listed.length} more`}
                      </Button>
                    )}
                    </div>
                  </section>
                )
              })}
            </div>
            <aside className={styles.panel} aria-label="Story details">
              {opened ? (
                <Panel
                  key={opened.id}
                  story={opened}
                  detail={detail && detail.id === opened.id ? detail : undefined}
                  canEdit={canEdit}
                  busy={detailBusy}
                  onChecklist={props.onChecklist}
                  onMove={(status) => move(opened, status, null)}
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
