import { Button, Checkbox, Dropdown, InlineNotification, Loading, Modal, OverflowMenu, OverflowMenuItem, Search, Tag, TextInput } from '@carbon/react'
import { useState } from 'react'
import { COLUMNS } from '../../../shared/board.mjs'
import type { Board, BoardStory, ChecklistInput, Priority, ProjectDetail, StoryDetail, StoryStatus } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { STATUS_LABEL } from './labels'
import styles from './StoriesView.module.scss'

const PRIORITY_LABEL: Record<Priority | 'all', string> = { all: 'All priorities', high: 'High', medium: 'Medium', low: 'Low' }
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
  errorText?: string
  onSearch: (q: string) => void
  onPriority: (p: Priority | 'all') => void
  onTheme: (id: string | null) => void
  onOpen: (id: string) => void
  onClose: () => void
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
  onOpen: (id: string) => void
  onMove: (story: BoardStory, status: StoryStatus, beforeId: string | null) => void
  onDragOver: (id: string) => void
  onDrop: (e: React.DragEvent) => void
}

function Card({ story, canEdit, busy, over, onOpen, onMove, onDragOver, onDrop }: CardProps) {
  return (
    <article
      className={styles.card}
      data-status={story.status}
      data-over={over}
      data-busy={busy}
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
      <Button kind="ghost" size="sm" className={styles.open} onClick={() => onOpen(story.id)}>
        <span className={styles.key}>{story.key}</span>
        <span className={styles.title}>{story.title}</span>
      </Button>
      <div className={styles.meta}>
        <Tag size="sm" type={story.priority === 'high' ? 'red' : story.priority === 'medium' ? 'gray' : 'cool-gray'}>
          {PRIORITY_LABEL[story.priority]}
        </Tag>
        {story.kind === 'open_question' && <Tag size="sm" type="purple">Question</Tag>}
        {story.ownerTeam && <span className={styles.owner}>{story.ownerTeam}</span>}
      </div>
      {story.theme && <p className={styles.theme}>{story.theme.title}</p>}
      {story.criteriaTotal > 0 && (
        <p className={styles.progress}>
          {story.criteriaMet} of {story.criteriaTotal} criteria met
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

function Detail({ detail, canEdit, busy, onPatch, onChecklist, onMove, onClose }: Pick<StoriesViewProps, 'canEdit' | 'onPatch' | 'onChecklist' | 'onClose'> & { detail: StoryDetail; busy: boolean; onMove: (status: StoryStatus) => void }) {
  const [owner, setOwner] = useState(detail.ownerTeam ?? '')
  const [text, setText] = useState('')
  const [kind, setKind] = useState<'criterion' | 'task'>('criterion')
  const items: ChecklistInput[] = detail.checklist.map((c) => ({ id: c.id, kind: c.kind, text: c.text, met: c.met }))
  const set = (next: ChecklistInput[]) => onChecklist(next)
  return (
    <div className={styles.detail}>
      {detail.summary && <p className={styles.body}>{detail.summary}</p>}
      {detail.whyItMatters && (
        <p className={styles.body}>
          <strong>Why it matters.</strong> {detail.whyItMatters}
        </p>
      )}
      {detail.nextStep && (
        <p className={styles.body}>
          <strong>Next step.</strong> {detail.nextStep}
        </p>
      )}
      {detail.theme && (
        <p className={styles.body}>
          Evidence: {detail.theme.title}, {detail.theme.participantCount} of {detail.theme.totalParticipants} participants.
        </p>
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
        <div className={styles.owner_field}>
          <TextInput id="story-owner" labelText="Owner team" value={owner} readOnly={!canEdit} onChange={(e) => setOwner(e.target.value)} />
          {canEdit && (
            <Button kind="tertiary" size="md" disabled={busy || owner.trim() === (detail.ownerTeam ?? '')} onClick={() => onPatch({ ownerTeam: owner })}>
              Save owner
            </Button>
          )}
        </div>
      </div>
      <h3 className={styles.sub}>Checklist</h3>
      {items.length === 0 && <p className={styles.body}>No acceptance criteria or tasks yet.</p>}
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
      )}
      <div className={styles.footer}>
        <Button kind="secondary" size="md" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}

// Presentational: the four-column board with filters, drag and a "Move to" alternative, Undo, and a card panel.
export function StoriesView(props: StoriesViewProps) {
  const { state, board, stories, canEdit, moving, search, priority, themeId, openId, detail, detailBusy, undoing, errorText } = props
  const [drag, setDrag] = useState<{ column: StoryStatus; before: string | null } | null>(null)
  const byId = (id: string) => board?.stories.find((s) => s.id === id)
  const drop = (e: React.DragEvent, status: StoryStatus, beforeId: string | null) => {
    e.preventDefault()
    setDrag(null)
    const story = byId(e.dataTransfer.getData('text/plain'))
    if (story && story.id !== beforeId) props.onMove(story, status, beforeId)
  }
  const opened = openId ? byId(openId) : undefined

  return (
    <div className={styles.page}>
      <ProjectHeader
        title="Stories"
        description="Drag a card to another column, or use its menu. Each card is a requirement or an open question from the published document."
      />
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
            <Search id="story-search" size="md" labelText="Search stories" placeholder="Search stories" value={search} onChange={(e: { target: { value: string } }) => props.onSearch(e.target.value)} onClear={() => props.onSearch('')} />
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
            {canEdit && board.lastMove && (
              <Button kind="secondary" size="md" disabled={undoing} onClick={props.onUndo}>
                Undo move of {board.lastMove.key}
              </Button>
            )}
          </div>
          <div className={styles.themes} role="group" aria-label="Filter by theme">
            {board.themes.map((t) => (
              <Button key={t.id} kind={themeId === t.id ? 'primary' : 'ghost'} size="sm" aria-pressed={themeId === t.id} onClick={() => props.onTheme(themeId === t.id ? null : t.id)}>
                {t.title} ({t.count})
              </Button>
            ))}
          </div>
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
                  {cards.map((s) => (
                    <div key={s.id}>
                      <Card
                        story={s}
                        canEdit={canEdit}
                        busy={moving.has(s.id)}
                        over={drag?.column === status && drag.before === s.id}
                        onOpen={props.onOpen}
                        onMove={props.onMove}
                        onDragOver={(id) => (drag?.column !== status || drag.before !== id) && setDrag({ column: status, before: id })}
                        onDrop={(e) => drop(e, status, s.id)}
                      />
                    </div>
                  ))}
                  {cards.length === 0 && <p className={styles.none}>No stories</p>}
                </section>
              )
            })}
          </div>
        </>
      )}
      <Modal
        open={!!openId}
        modalHeading={opened ? `${opened.key}: ${opened.title}` : 'Story'}
        passiveModal
        onRequestClose={props.onClose}
      >
        {detail ? (
          <Detail
            detail={detail}
            canEdit={canEdit}
            busy={detailBusy}
            onPatch={props.onPatch}
            onChecklist={props.onChecklist}
            onClose={props.onClose}
            onMove={(status) => opened && props.onMove(opened, status, null)}
          />
        ) : (
          <Loading withOverlay={false} description="Loading the story" />
        )}
      </Modal>
    </div>
  )
}
