import { Button, InlineNotification, Loading, Tab, TabList, TabPanel, TabPanels, Tabs, Tag } from '@carbon/react'
import { useState } from 'react'
import type { BoardStory, CreateTicketInput, ProjectDetail, StoryDetail, Ticket } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { CreateTicketModal } from './CreateTicketModal'
import { priorityLabel, readiness, storyMarkdown, ticketBody } from './jira'
import styles from './StoriesView.module.scss'

export type StoriesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  project?: ProjectDetail
  stories: BoardStory[]
  tickets: Ticket[]
  tab: 'prepare' | 'sent'
  openId: string | null
  detail?: StoryDetail
  canEdit: boolean
  errorText?: string
  creating: boolean
  createError?: string
  /** The address of a story in this tool, which goes into the ticket as its evidence link. */
  linkTo: (story: { key: string }) => string
  onTab: (tab: 'prepare' | 'sent') => void
  onOpen: (id: string) => void
  /** Resolves true when the ticket was made (the dialog then closes). */
  onCreate: (storyId: string, input: CreateTicketInput) => Promise<boolean>
  onGoRequirements: () => void
  /** Opens the Design step with this requirement's row open. */
  onViewDesign: (story: BoardStory) => void
}

const byKey = (a: BoardStory, b: BoardStory) => a.key.localeCompare(b.key, undefined, { numeric: true })
const when = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// Presentational: the Stories step as a hand-off to Jira. Prepare for Jira lists the requirements to the left, shows the selected one in
// full (read-only: the document is the source) and a Jira preview with what is still thin; Sent to Jira is the record of what was created.
// The only editing is in the Create ticket dialog.
export function StoriesView(props: StoriesViewProps) {
  const { state, stories, tickets, tab, openId, errorText } = props
  const sentBy = new Map(tickets.filter((t) => t.storyId).map((t) => [t.storyId as string, t]))
  const requirements = stories.filter((s) => s.kind === 'requirement').sort(byKey)
  const toPrepare = requirements.filter((s) => !sentBy.has(s.id))
  const sent = requirements.filter((s) => sentBy.has(s.id))
  const questions = stories.filter((s) => s.kind === 'open_question').sort(byKey)
  const opened = stories.find((s) => s.id === openId)

  return (
    <div className={styles.page}>
      <ProjectHeader
        title="Stories"
        description={
          state === 'ready'
            ? `${plural(requirements.length, 'requirement')} from the requirements document: ${toPrepare.length} to prepare, ${sent.length} sent to Jira.`
            : 'Each requirement from the published document, prepared for Jira.'
        }
      />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading the stories" />}
      {state === 'error' && !errorText && <p className={styles.empty}>The stories could not be loaded.</p>}
      {state === 'empty' && (
        <div className={styles.emptyState}>
          <p className={styles.empty}>Publish a requirements document and its requirements appear here, ready for Jira.</p>
          <Button kind="primary" size="md" onClick={props.onGoRequirements}>
            Go to Requirements
          </Button>
        </div>
      )}
      {state === 'ready' && (
        <Tabs selectedIndex={tab === 'sent' ? 1 : 0} onChange={({ selectedIndex }) => props.onTab(selectedIndex === 1 ? 'sent' : 'prepare')}>
          <TabList aria-label="Stories">
            <Tab data-testid="tab-prepare">Prepare for Jira · {toPrepare.length}</Tab>
            <Tab data-testid="tab-sent">Sent to Jira · {tickets.length}</Tab>
          </TabList>
          <TabPanels>
            <TabPanel className={styles.tabPanel}>
              {tab === 'prepare' && (
                <div className={styles.workspace}>
                  <nav className={styles.list} aria-label="Requirements">
                    <Group title="To prepare" stories={toPrepare} openId={openId} sentBy={sentBy} onOpen={props.onOpen} />
                    <Group title="Needs a decision" stories={questions} openId={openId} sentBy={sentBy} onOpen={props.onOpen} />
                    <Group title="Sent to Jira" stories={sent} openId={openId} sentBy={sentBy} onOpen={props.onOpen} />
                  </nav>
                  {opened ? (
                    <Selected story={opened} ticket={sentBy.get(opened.id)} {...props} />
                  ) : (
                    <p className={styles.empty}>Choose a requirement.</p>
                  )}
                </div>
              )}
            </TabPanel>
            <TabPanel className={styles.tabPanel}>{tab === 'sent' && <SentList tickets={tickets} onOpen={props.onOpen} onTab={props.onTab} />}</TabPanel>
          </TabPanels>
        </Tabs>
      )}
    </div>
  )
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

function Group({ title, stories, openId, sentBy, onOpen }: { title: string; stories: BoardStory[]; openId: string | null; sentBy: Map<string, Ticket>; onOpen: (id: string) => void }) {
  if (stories.length === 0) return null
  return (
    <section className={styles.group} aria-label={title}>
      <h2 className={styles.groupHead}>{title}</h2>
      {stories.map((s) => (
        <Button key={s.id} kind="ghost" size="md" className={styles.item} data-testid={`story-${s.key}`} aria-current={s.id === openId ? 'true' : undefined} onClick={() => onOpen(s.id)}>
          <span className={styles.itemText}>
            <strong>{s.key}</strong> {s.title}
          </span>
          {sentBy.get(s.id) && <span className={styles.itemKey}>{sentBy.get(s.id)!.jiraKey}</span>}
        </Button>
      ))}
    </section>
  )
}

type SelectedProps = StoriesViewProps & { story: BoardStory; ticket?: Ticket }

// The selected story: all of it, read-only, then the Jira preview and the button that opens the dialog.
function Selected({ story, detail, ticket, canEdit, creating, createError, linkTo, onTab, onCreate, onViewDesign }: SelectedProps) {
  const [modal, setModal] = useState(false)
  const [copied, setCopied] = useState(false)
  const question = story.kind === 'open_question'
  const link = linkTo(story)
  const checks = detail ? readiness(detail) : []
  const criteria = detail?.checklist.filter((c) => c.kind === 'criterion') ?? []
  const tasks = detail?.checklist.filter((c) => c.kind === 'task') ?? []
  return (
    <>
      <article className={styles.detail} aria-label={`${story.key} ${story.title}`} data-testid="story-detail">
        <p className={styles.kicker}>
          {story.key} · {story.theme?.title ?? 'No theme'}
        </p>
        <h2 className={styles.title}>{story.title}</h2>
        <div className={styles.tags}>
          {question ? (
            <Tag size="md" type="purple">
              Open question
            </Tag>
          ) : (
            <Tag size="md" type="outline">
              {priorityLabel(story.priority)} priority
            </Tag>
          )}
          {story.theme && (
            <Tag size="md" type="outline">
              Raised by {story.theme.participantCount} of {story.theme.totalParticipants} participants
            </Tag>
          )}
          {!question && (
            <Button kind="ghost" size="sm" onClick={() => onViewDesign(story)}>
              Design →
            </Button>
          )}
        </div>
        {!detail && <Loading small withOverlay={false} description="Loading the story" />}
        {detail && (
          <>
            {detail.syncNote && <InlineNotification kind="warning" lowContrast hideCloseButton title="Out of step with the document" subtitle={detail.syncNote} />}
            {detail.summary && (
              <section className={styles.block} aria-label="Story">
                <h3 className={styles.blockHead}>Story</h3>
                <p className={styles.text}>{detail.summary}</p>
              </section>
            )}
            <section className={styles.block} aria-label="Acceptance criteria">
              <h3 className={styles.blockHead}>Acceptance criteria</h3>
              {criteria.length === 0 ? (
                <p className={styles.muted}>No acceptance criteria yet.</p>
              ) : (
                <ul className={styles.criteria}>
                  {criteria.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
              )}
            </section>
            {tasks.length > 0 && (
              <section className={styles.block} aria-label="Tasks">
                <h3 className={styles.blockHead}>Tasks</h3>
                <ul className={styles.criteria}>
                  {tasks.map((c) => (
                    <li key={c.id}>{c.text}</li>
                  ))}
                </ul>
              </section>
            )}
            <div className={styles.pair}>
              {detail.whyItMatters && (
                <section className={styles.block} aria-label="Why it matters">
                  <h3 className={styles.blockHead}>Why it matters</h3>
                  <p className={styles.text}>{detail.whyItMatters}</p>
                </section>
              )}
              {detail.nextStep && (
                <section className={styles.block} aria-label="Next step">
                  <h3 className={styles.blockHead}>Next step</h3>
                  <p className={styles.text}>{detail.nextStep}</p>
                </section>
              )}
            </div>
          </>
        )}
      </article>

      <aside className={styles.side} aria-label="Jira">
        {question ? (
          <>
            <h3 className={styles.blockHead}>Needs a decision</h3>
            <p className={styles.text}>An open question is a decision to make, not a ticket. Once it is decided, the answer belongs in the requirements document.</p>
          </>
        ) : (
          <>
            <h3 className={styles.blockHead}>Jira preview</h3>
            {detail ? (
              <div className={styles.preview}>
                <p className={styles.previewMeta}>
                  {ticket ? ticket.issueType : 'Story'} · {priorityLabel(ticket?.priority ?? story.priority)}
                </p>
                <p className={styles.previewTitle}>{ticket ? ticket.summary : story.title}</p>
                <p className={styles.previewBody}>{ticket ? ticket.description : ticketBody(detail, link)}</p>
              </div>
            ) : (
              <Loading small withOverlay={false} description="Loading the preview" />
            )}
            {!ticket && detail && (
              <>
                <h3 className={styles.blockHead}>Readiness</h3>
                <ul className={styles.checks}>
                  {checks.map((c) => (
                    <li key={c.label} data-ok={c.ok}>
                      <span aria-hidden>{c.ok ? '✓' : '○'}</span> {c.label}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {ticket ? (
              <div className={styles.done} data-testid="ticket-done">
                <p className={styles.doneText}>Ticket {ticket.jiraKey} created</p>
                <p className={styles.muted}>
                  {ticket.createdBy?.name ?? 'Someone'} · {when(ticket.createdAt)}
                </p>
                <Button kind="ghost" size="sm" onClick={() => onTab('sent')}>
                  View in Sent to Jira
                </Button>
              </div>
            ) : (
              <Button kind="primary" size="md" className={styles.create} disabled={!canEdit || !detail} data-testid="create-ticket" onClick={() => setModal(true)}>
                Create Jira ticket
              </Button>
            )}
          </>
        )}
        <Button
          kind="ghost"
          size="sm"
          disabled={!detail}
          onClick={() => {
            if (!detail) return
            void navigator.clipboard?.writeText(storyMarkdown(detail, link)).catch(() => undefined)
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          }}
        >
          {copied ? 'Copied' : 'Copy as Markdown'}
        </Button>
      </aside>

      {detail && !question && !ticket && (
        <CreateTicketModal
          story={detail}
          link={link}
          open={modal}
          pending={creating}
          errorText={createError}
          onClose={() => setModal(false)}
          onCreate={(input) => void onCreate(story.id, input).then((made) => made && setModal(false))}
        />
      )}
    </>
  )
}

// The record: what was sent, to which project, by whom and when. A story's own key opens it again on Prepare for Jira.
function SentList({ tickets, onOpen, onTab }: { tickets: Ticket[]; onOpen: (id: string) => void; onTab: (tab: 'prepare' | 'sent') => void }) {
  return (
    <div className={styles.sent}>
      <p className={styles.muted}>Stories sent to Jira from this tool. The Jira connection is simulated for now: the keys are made here and nothing reached Jira.</p>
      {tickets.length === 0 ? (
        <p className={styles.emptyBox}>Nothing sent yet. Open a requirement on Prepare for Jira and choose Create Jira ticket.</p>
      ) : (
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="Tickets sent to Jira" data-testid="sent-table">
            <div className={styles.row} role="row">
              {['Jira key', 'Summary', 'Story', 'Priority', 'Assignee', 'Created by', 'Created'].map((h) => (
                <div key={h} className={styles.head} role="columnheader">
                  {h}
                </div>
              ))}
            </div>
            {tickets.map((t) => (
              <div key={t.id} className={styles.row} role="row" data-testid={`ticket-${t.jiraKey}`}>
                <div role="cell" className={styles.jiraKey}>
                  {t.jiraKey}
                </div>
                <div role="cell">
                  <p className={styles.summary}>{t.summary}</p>
                  <p className={styles.meta}>
                    {t.issueType} · {t.project}
                    {t.labels ? ` · ${t.labels}` : ''}
                    {t.points ? ` · ${t.points} pts` : ''}
                  </p>
                </div>
                <div role="cell">
                  {t.storyId ? (
                    <Button
                      kind="ghost"
                      size="sm"
                      onClick={() => {
                        onOpen(t.storyId!)
                        onTab('prepare')
                      }}
                    >
                      {t.storyKey}
                    </Button>
                  ) : (
                    <span>{t.storyKey}</span>
                  )}
                </div>
                <div role="cell">{t.priority}</div>
                <div role="cell">{t.assignee}</div>
                <div role="cell">{t.createdBy?.name ?? 'Someone'}</div>
                <div role="cell" className={styles.when}>
                  {when(t.createdAt)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
