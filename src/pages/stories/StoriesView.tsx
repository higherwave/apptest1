import { Button, Checkbox, Dropdown, InlineNotification, Loading, OverflowMenu, OverflowMenuItem, Search, Tag, TextInput } from '@carbon/react'
import { useState } from 'react'
import { COLUMNS } from '../../../shared/board.mjs'
import type { Board, BoardStory, ChecklistInput, Priority, ProjectDetail, StoryDetail, StoryStatus } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { STATUS_HINT, STATUS_LABEL } from './labels'
import styles from './StoriesView.module.scss'

const PRIORITY_LABEL: Record<Priority | 'all', string> = { all: 'All', high: 'High', medium: 'Medium', low: 'Low' }
// Themes beyond these go under a "more" menu so the filter row stays on one line.
const THEME_CHIPS = 4
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
  themeId: string | null
  openId: string | null
  detail?: StoryDetail
  detailBusy: boolean
  undoing: boolean
  saving: boolean
  /** When the last change was saved this session, for the status line. */
  savedAt?: string
  errorText?: string
  onSearch: (q: string) => void
  onPriority: (p: Priority | 'all') => void
  onTheme: (id: string | null) => void
  onOpen: (id: string) => void
  onMove: (story: BoardStory, status: StoryStatus, beforeId: string | null) => void
  onUndo: () => void
  onPatch: (body: { ownerTeam?: string | null; priority?: Priority }) => void
  onChecklist: (items: ChecklistInput[]) => void
  onGoRequirements: () => void
}

type CardProps = {
  story: BoardStory
  canEdit: boolean
  busy: boolean
  over: boolean
  selected: boolean
  onOpen: (id: string) => void
  onMove: (story: BoardStory, status: StoryStatus, beforeId: string | null) => void
  onDragOver: (id: string) => void
  onDrop: (e: React.DragEvent) => void
}

function Card({ story, canEdit, busy, over, selected, onOpen, onMove, onDragOver, onDrop }: CardProps) {
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
      <div className={styles.cardTop}>
        <span className={styles.priority} data-priority={story.priority}>
          {PRIORITY_LABEL[story.priority]}
        </span>
        {story.kind === 'open_question' && (
          <Tag size="sm" type="purple">
            Question
          </Tag>
        )}
      </div>
      <Button kind="ghost" size="sm" className={styles.open} aria-pressed={selected} onClick={() => onOpen(story.id)}>
        <span className={styles.title}>
          {story.key} — {story.title}
        </span>
      </Button>
      {story.theme && <p className={styles.theme}>{story.theme.title}</p>}
      {(story.ownerTeam || story.criteriaTotal > 0) && (
        <p className={styles.progress}>
          {[story.ownerTeam, story.criteriaTotal > 0 ? `${story.criteriaMet} of ${story.criteriaTotal} criteria met` : null].filter(Boolean).join(' · ')}
        </p>
      )}
      {canEdit && (
        <div className={styles.menu}>
          <OverflowMenu iconDescription={`Move ${story.key}`} flipped size="sm">
            {COLUMNS.filter((c: StoryStatus) => c !== story.status).map((c: StoryStatus) => (
              <OverflowMenuItem key={c} itemText={`Move to ${STATUS_LABEL[c]}`} onClick={() => onMove(story, c, null)} />
            ))}
          </OverflowMenu>
        </div>
      )}
    </article>
  )
}

type PanelProps = Pick<StoriesViewProps, 'canEdit' | 'onPatch' | 'onChecklist'> & {
  story: BoardStory
  detail?: StoryDetail
  busy: boolean
  onMove: (status: StoryStatus) => void
}

// The static panel on the right: whatever card is selected, with its owner, priority, status and checklist to edit.
function Panel({ story, detail, canEdit, busy, onPatch, onChecklist, onMove }: PanelProps) {
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
        <Tag size="md" type={story.priority === 'high' ? 'red' : 'outline'}>
          {PRIORITY_LABEL[story.priority]} priority
        </Tag>
        {story.kind === 'open_question' && (
          <Tag size="md" type="purple">
            Open question
          </Tag>
        )}
      </div>
      {!detail && <Loading small withOverlay={false} description="Loading the story" />}
      {detail && <Editable key={detail.id} detail={detail} canEdit={canEdit} busy={busy} onPatch={onPatch} onChecklist={onChecklist} onMove={onMove} />}
    </div>
  )
}

function Editable({ detail, canEdit, busy, onPatch, onChecklist, onMove }: Pick<StoriesViewProps, 'canEdit' | 'onPatch' | 'onChecklist'> & { detail: StoryDetail; busy: boolean; onMove: (status: StoryStatus) => void }) {
  const [owner, setOwner] = useState(detail.ownerTeam ?? '')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'criterion' | 'task'>('criterion')
  const items: ChecklistInput[] = detail.checklist.map((c) => ({ id: c.id, kind: c.kind, text: c.text, met: c.met }))
  const set = (next: ChecklistInput[]) => onChecklist(next)
  const met = detail.checklist.filter((c) => c.met).length
  return (
    <>
      {detail.summary && <p className={styles.summary}>{detail.summary}</p>}
      <div className={styles.facts}>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Owner</span>
          <span className={styles.factValue}>{detail.ownerTeam || 'Unassigned'}</span>
        </div>
        <div className={styles.fact}>
          <span className={styles.factLabel}>Priority</span>
          <span className={styles.factValue}>{PRIORITY_LABEL[detail.priority]}</span>
        </div>
        {detail.theme && (
          <div className={styles.fact}>
            <span className={styles.factLabel}>Raised by</span>
            <span className={styles.factValue}>
              {detail.theme.participantCount} of {detail.theme.totalParticipants} participants
            </span>
          </div>
        )}
        <div className={styles.fact}>
          <span className={styles.factLabel}>Acceptance criteria</span>
          <span className={styles.factValue}>{detail.checklist.length ? `${met} of ${detail.checklist.length} done` : 'Not defined yet'}</span>
        </div>
      </div>

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

      <div className={styles.fields}>
        <Dropdown
          id="story-status"
          titleText="Move to"
          label="Status"
          items={[...COLUMNS] as StoryStatus[]}
          itemToString={(s: StoryStatus | null) => (s ? STATUS_LABEL[s] : '')}
          selectedItem={detail.status}
          disabled={!canEdit || busy}
          onChange={({ selectedItem }: { selectedItem: StoryStatus | null | undefined }) => selectedItem && selectedItem !== detail.status && onMove(selectedItem)}
        />
        <Dropdown
          id="story-priority"
          titleText="Priority"
          label="Priority"
          items={['high', 'medium', 'low'] as Priority[]}
          itemToString={(p: Priority | null) => (p ? PRIORITY_LABEL[p] : '')}
          selectedItem={detail.priority}
          disabled={!canEdit || busy}
          onChange={({ selectedItem }: { selectedItem: Priority | null | undefined }) => selectedItem && selectedItem !== detail.priority && onPatch({ priority: selectedItem })}
        />
        <div className={styles.ownerField}>
          <TextInput id="story-owner" labelText="Owner team" value={owner} readOnly={!canEdit} onChange={(e) => setOwner(e.target.value)} />
          {canEdit && (
            <Button kind="tertiary" size="md" disabled={busy || owner.trim() === (detail.ownerTeam ?? '')} onClick={() => onPatch({ ownerTeam: owner })}>
              Save owner
            </Button>
          )}
        </div>
      </div>

      <h3 className={styles.sub}>Checklist</h3>
      {items.length === 0 && <p className={styles.noteText}>No acceptance criteria or tasks yet.</p>}
      <ul className={styles.list}>
        {detail.checklist.map((c, i) => (
          <li key={c.id} className={styles.item}>
            <Checkbox
              id={`check-${c.id}`}
              labelText={`${c.kind === 'criterion' ? 'Criterion' : 'Task'}: ${c.text}`}
              checked={c.met}
              disabled={!canEdit || busy}
              onChange={(_, { checked }) => set(items.map((it, j) => (j === i ? { ...it, met: checked } : it)))}
            />
            {canEdit && (
              <Button kind="ghost" size="sm" disabled={busy} onClick={() => set(items.filter((_, j) => j !== i))}>
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className={styles.add}>
          <TextInput id="story-new-item" labelText="New item" value={text} onChange={(e) => setText(e.target.value)} />
          <div className={styles.addActions}>
            <Button kind="tertiary" size="md" onClick={() => setKind(kind === 'criterion' ? 'task' : 'criterion')}>
              {kind === 'criterion' ? 'Criterion' : 'Task'}
            </Button>
            <Button
              kind="secondary"
              size="md"
              disabled={busy || !text.trim()}
              onClick={() => {
                set([...items, { kind, text: text.trim(), met: false }])
                setText('')
              }}
            >
              Add item
            </Button>
          </div>
        </div>
      )}

      <div className={styles.footer}>
        {/* A demo of the hand-off: it will open a Create ticket dialog once Jira is connected. */}
        <Button kind="primary" size="md">
          Create Jira Ticket
        </Button>
      </div>
    </>
  )
}

// Presentational: the four-column board with filters, drag and a "Move to" alternative, Undo, and a static panel for the selected card.
export function StoriesView(props: StoriesViewProps) {
  const { state, board, stories, canEdit, moving, search, priority, themeId, openId, detail, detailBusy, undoing, saving, savedAt, errorText } = props
  const [drag, setDrag] = useState<{ column: StoryStatus; before: string | null } | null>(null)
  const byId = (id: string) => board?.stories.find((s) => s.id === id)
  const drop = (e: React.DragEvent, status: StoryStatus, beforeId: string | null) => {
    e.preventDefault()
    setDrag(null)
    const story = byId(e.dataTransfer.getData('text/plain'))
    if (story && story.id !== beforeId) props.onMove(story, status, beforeId)
  }
  const opened = openId ? byId(openId) : undefined
  const inProgress = board?.stories.filter((s) => s.status === 'in_progress').length ?? 0
  const themes = board?.themes ?? []

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
            <div className={styles.themes} role="group" aria-label="Filter by theme">
              <span className={styles.filterLabel}>Theme</span>
              {themes.slice(0, THEME_CHIPS).map((t) => (
                <Button key={t.id} kind={themeId === t.id ? 'primary' : 'tertiary'} size="md" className={styles.themeChip} title={`${t.title} (${t.count})`} aria-pressed={themeId === t.id} onClick={() => props.onTheme(themeId === t.id ? null : t.id)}>
                  {t.title}
                </Button>
              ))}
              {themes.length > THEME_CHIPS && (
                <OverflowMenu iconDescription="More themes" flipped size="md">
                  {themes.slice(THEME_CHIPS).map((t) => (
                    <OverflowMenuItem key={t.id} itemText={`${t.title} (${t.count})`} onClick={() => props.onTheme(themeId === t.id ? null : t.id)} />
                  ))}
                </OverflowMenu>
              )}
              {themeId && (
                <Button kind="ghost" size="md" onClick={() => props.onTheme(null)}>
                  Clear
                </Button>
              )}
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
          <div className={styles.layout}>
            <div className={styles.board}>
              {COLUMNS.map((status: StoryStatus) => {
                const cards = stories.filter((s) => s.status === status).sort((a, b) => a.position - b.position)
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
                    <h2 className={styles.columnHead}>
                      {STATUS_LABEL[status]} <span className={styles.count}>{cards.length}</span>
                    </h2>
                    <p className={styles.hint}>{STATUS_HINT[status]}</p>
                    {cards.map((s) => (
                      <div key={s.id}>
                        <Card
                          story={s}
                          canEdit={canEdit}
                          busy={moving.has(s.id)}
                          over={drag?.column === status && drag.before === s.id}
                          selected={openId === s.id}
                          onOpen={props.onOpen}
                          onMove={props.onMove}
                          onDragOver={(id) => (drag?.column !== status || drag.before !== id) && setDrag({ column: status, before: id })}
                          onDrop={(e) => drop(e, status, s.id)}
                        />
                      </div>
                    ))}
                    {cards.length === 0 && <p className={styles.none}>Nothing here under the current filters.</p>}
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
                  onPatch={props.onPatch}
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
    </div>
  )
}
