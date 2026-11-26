import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Information } from '@carbon/icons-react'
import { Button, Checkbox, Tab, TabList, TabPanel, TabPanels, Tabs, InlineNotification, Modal, OverflowMenu, RadioButton, OverflowMenuItem, Select, SelectItem, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextArea, TextInput } from '@carbon/react'
import { Link, useSearchParams } from 'react-router-dom'
import { friendlyMessage, type DismissReason, type PulseTopic } from '../../api/client'
import { useDismissPulseTopic, useMe, useMergePulseTopic, usePulseTopics, useRenamePulseTopic, useUpdatePulseTopics } from '../../api/hooks'
import { SkeletonList, SkeletonRegion } from '../../components/Skeletons'
import { PageHero } from '../../shell/PageHero'
import { AddCallNotes } from './AddCallNotes'
import { activeChannels } from './channels'
import { CreateProjectPanel } from './CreateProjectPanel'
import { money, moneyFull } from './money'
import { PulseNotFound } from './PulseNotFound'
import { Why } from './Why'
import { useTopicSelection } from './selection'
import { TopPriorities } from './TopPriorities'
import { trendTag } from './trend'
import styles from './TopicsPage.module.scss'

/** Top Priorities shows this many topics; All Topics has them all. */
const TOP_N = 6
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
// "claude-sonnet-5-5" reads as "Claude Sonnet 5.5".
const modelName = (id: string | null) => {
  const m = id?.match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/)
  return m ? `Claude ${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : 'an AI model'
}
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null)

// Pulse's default page: what customers keep raising, ranked. Topics are kept signals grouped together; each row says how many were heard in which channel (the numbers are always
// printed, the shading only helps the eye) and, on request, exactly why it ranks where it does. Rankings change only when topics are updated, never while someone is reading.
export function TopicsPage() {
  const me = useMe()
  const topics = useTopics()
  const update = useUpdatePulseTopics()
  const [open, setOpen] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<PulseTopic | null>(null)
  const [merging, setMerging] = useState<PulseTopic | null>(null)
  const [creating, setCreating] = useState(false)
  const [dismissing, setDismissing] = useState<PulseTopic | null>(null)
  const [adding, setAdding] = useState(false)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'all' ? 1 : 0
  const [rankBy, setRankBy] = useState<'score' | 'arr' | 'play'>('score')
  const { selected, toggle, clear, keepOnly } = useTopicSelection()
  // A topic that was merged away or regrouped can no longer be picked.
  const validIds = topics.data?.topics.map((t) => t.id)
  useEffect(() => { if (validIds) keepOnly(validIds) }, [validIds?.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!me.data) return null
  if (!me.data.features.pulse) return <PulseNotFound />
  const list = topics.data
  const total = list?.topics.reduce((a, t) => a + t.signals, 0) ?? 0
  const channels = activeChannels(list?.topics ?? [])
  const max = Math.max(1, ...(list?.topics.flatMap((t) => channels.map((c) => t.channels[c.key] ?? 0)) ?? [1]))
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999)))
  // ARR shows only once accounts have been copied from Salesforce (the server sends null otherwise).
  const hasArr = !!list?.topics.some((t) => t.arr !== null)
  // Opportunity notes put a figure on what is in play; "Rank by" orders the list by it. The score order stays the default, and the score is always shown.
  const hasPlay = !!list?.topics.some((t) => t.inPlay)
  const playOf = (t: PulseTopic) => t.inPlay?.open.amount ?? 0
  const rankOptions = [{ key: 'score', label: 'Signal score' }, ...(hasArr ? [{ key: 'arr', label: 'ARR' }] : []), ...(hasPlay ? [{ key: 'play', label: 'In play' }] : [])]
  const orderedTopics = list
    ? [...list.topics].sort((a, b) => {
        const by = rankBy === 'arr' && hasArr ? (b.arr ?? 0) - (a.arr ?? 0) : rankBy === 'play' && hasPlay ? playOf(b) - playOf(a) : 0
        return by || a.rank - b.rank
      })
    : []
  // Top Priorities leaves out quiet topics (nothing heard for about two months); they stay in All Topics.
  const topPriorities = orderedTopics.filter((t) => !t.quiet).slice(0, TOP_N)
  // Owners and editors change things; a member who was only given view sees the topics, quotes and numbers.
  const canStart = me.data.features.pulseEdit
  // Anyone who can see Pulse can pick topics and look at what a project would start from; only an editor can create it, add notes, rename, merge or dismiss.
  const picked = list?.topics.filter((t) => selected.includes(t.id)) ?? []
  const pickedSignals = picked.reduce((a, t) => a + t.signals, 0)
  // On Top Priorities the label sits at the left of the card list and the dropdown stretches to its right edge; above the table it keeps its own width, at the right.
  const rankBarFor = (stretch: boolean) => hasArr || hasPlay ? (
    <div className={styles.rankBy} data-stretch={stretch} data-testid="rank-by">
      <Select id="rank-by-select" data-testid="rank-by-select" size="sm" inline labelText="Rank by" value={rankBy} onChange={(e) => setRankBy(e.target.value as 'score' | 'arr' | 'play')}>
        {rankOptions.map((o) => (
          <SelectItem key={o.key} value={o.key} text={o.label} />
        ))}
      </Select>
    </div>
  ) : null

  return (
    <div className={styles.page}>
      <PageHero title="Topics" description="What customers keep raising, found by Pulse in Slack, Salesforce and call notes, and ranked by how much each counts" glow="left" variant="wave" graphic="pulse" />

      {topics.isPending && (
        <SkeletonRegion label="Loading topics">
          <SkeletonList rows={6} />
        </SkeletonRegion>
      )}
      {topics.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Topics could not be loaded" subtitle={friendlyMessage(topics.error)} />}
      {update.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Topics were not updated" subtitle={friendlyMessage(update.error)} />}

      {list && list.sinceUpdate > 0 && (
        <ul className={styles.notes} aria-label="Waiting">
          <li data-testid="topics-since">
            {plural(list.sinceUpdate, 'signal')} added since topics were last updated.{' '}
            {list.scheduledUpdates ? 'Topics update by themselves every hour.' : canStart ? 'Update topics in Settings, Pulse to include them.' : 'They are included the next time an owner or editor updates topics.'}
          </li>
        </ul>
      )}

      {list && list.topics.length > 0 && list.grouping && (
        <p className={styles.howFormed} data-testid="topics-how">
          {list.grouping.by === 'model'
            ? `How these topics were formed: ${modelName(list.grouping.model)} read the text of each signal and decided which belong together and what to call the group. Every count, score and dollar figure is calculated from the signals, never written by the AI. A topic you rename, merge, split or dismiss stays as you set it.`
            : list.grouping.fallback
              ? `How these topics were formed: by matching shared words, because ${list.grouping.fallback === 'budget' ? 'this month’s AI budget is used up' : 'the AI account has run out of credit'}. Every count, score and dollar figure is calculated from the signals. A topic you rename, merge, split or dismiss stays as you set it.`
              : 'How these topics were formed: by matching words that signals share. Every count, score and dollar figure is calculated from the signals. A topic you rename, merge, split or dismiss stays as you set it.'}
          {list.grouping.at ? ` Last grouped ${when(list.grouping.at)}.` : ''}
        </p>
      )}

      {list && !list.topics.length && (
        <section className={styles.empty} data-testid="topics-empty">
          <p className={styles.text}>No topics yet. A topic forms when at least two signals are about the same thing. Pulse reads the Slack channels and Salesforce notes set up in Settings; you can also add call notes.</p>
          {canStart && <div className={styles.emptyActions}>
            <Button kind="primary" size="md" data-testid="topics-update" disabled={update.isPending} onClick={() => update.mutate('regroup')}>
              Update topics
            </Button>
            <Button kind="ghost" size="md" data-testid="empty-add-notes" onClick={() => setAdding(true)}>
              Add call notes
            </Button>
          </div>}
        </section>
      )}

      {list && list.topics.length > 0 && (
        <div className={styles.tabsWrap}>
        <p className={styles.statusText} data-testid="topics-status">
          <span>{`${plural(list.topics.length, 'topic')} from ${plural(total, 'kept signal')}`}</span>
          <span>{list.updatedAt ? `Updated ${when(list.updatedAt)}` : 'Not updated yet'}</span>
        </p>
        <Tabs selectedIndex={tab} onChange={({ selectedIndex }) => setParams(selectedIndex === 1 ? { tab: 'all' } : {}, { replace: true })}>
          <TabList aria-label="Topics views">
            <Tab data-testid="tab-top">Top Priorities</Tab>
            <Tab data-testid="tab-all">All Topics</Tab>
          </TabList>
          <TabPanels>
            <TabPanel className={styles.tabPanel}>
              {tab === 0 && (
                <>
                  {topPriorities.length === 0 ? (
                    <p className={styles.text} data-testid="top-empty">Nothing has been heard about any topic lately, so no topic is a priority right now. Every topic is in All Topics.</p>
                  ) : (
                    <TopPriorities rankBar={rankBarFor(true)} allTopics={list.topics} topics={topPriorities} ordered={topPriorities} hasArr={hasArr} canStart={canStart} selected={selected} onToggle={toggle} onDismiss={setDismissing} />
                  )}
                </>
              )}
            </TabPanel>
            <TabPanel className={styles.tabPanel}>
              {tab === 1 && (
                <>
                <div className={styles.tableGroup}>
                  <div className={styles.tableHead} data-testid="table-toolbar">
                    <div>
                      <h2 className={styles.tableTitle}>
                        Where topics were heard
                        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Information} iconDescription="Signals per channel. Darker means more. Open “Why it ranks here” to see the weights behind the score." tooltipPosition="bottom" tooltipAlignment="start" className={styles.info} data-testid="table-info" />
                      </h2>
                    </div>
                    <div className={styles.toolbarRight}>
                      {rankBarFor(false)}
                      {canStart && (
                        <Button kind="tertiary" size="sm" data-testid="add-notes" onClick={() => setAdding(true)}>
                          Add call notes
                        </Button>
                      )}
                    </div>
                  </div>
                <TableContainer className={styles.table}>
                  <Table size="lg" aria-label="Topics by channel" data-testid="topics-grid">
                    <TableHead>
                      <TableRow>
                        <TableHeader className={styles.checkCol}>
                          <span className={styles.srOnly}>Select</span>
                        </TableHeader>
                        <TableHeader className={styles.rankCol}>#</TableHeader>
                        <TableHeader>Topic</TableHeader>
                        {channels.map((c) => (
                          <TableHeader key={c.key} className={styles.chCol}>
                            {c.label}
                          </TableHeader>
                        ))}
                        <TableHeader className={styles.numCol}>Heard in</TableHeader>
                        {hasArr && <TableHeader className={styles.numCol}>ARR</TableHeader>}
                        {hasPlay && <TableHeader className={styles.numCol}>In play</TableHeader>}
                        <TableHeader className={styles.numCol}>Score</TableHeader>
                        <TableHeader className={styles.menuCol}>
                          <span className={styles.srOnly}>Actions</span>
                        </TableHeader>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {orderedTopics.map((t, position) => (
                        <Fragment key={t.id}>
                          <TableRow data-testid={`topic-${t.id}`} data-rank={t.rank} data-open={open === t.id}>
                            <TableCell className={styles.checkCol}>
                              <Checkbox id={`pick-${t.id}`} data-testid={`pick-${t.id}`} labelText={`Select ${t.title}`} hideLabel checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                            </TableCell>
                            <TableCell className={styles.rankCol}>{position + 1}</TableCell>
                            <TableCell>
                              <div className={styles.topic}>
                                <Link to={`/pulse/topics/${t.id}`} className={styles.title} data-testid="topic-title">
                                  {t.title}
                                </Link>
                                <span className={styles.meta}>
                                  {plural(t.signals, 'signal')} · {plural(t.reach, 'account')}
                                  <Tag type={trendTag(t).type} size="sm" data-testid={`trend-${t.id}`}>
                                    {trendTag(t).label}
                                  </Tag>
                                  {t.researched.length > 0 && (
                                    <Tag type="teal" size="sm" data-testid={`researched-${t.id}`}>
                                      Signal Flow Match
                                    </Tag>
                                  )}
                                  {t.projects.length > 0 && (
                                    <Tag type="cyan" size="sm" data-testid={`in-project-${t.id}`}>
                                      {plural(t.projects.length, 'project')}
                                    </Tag>
                                  )}
                                </span>
                                <Button kind="ghost" size="sm" className={styles.why} renderIcon={open === t.id ? ChevronUp : ChevronDown} aria-expanded={open === t.id} data-testid={`why-${t.id}`} onClick={() => setOpen(open === t.id ? null : t.id)}>
                                  Why it ranks here
                                </Button>
                              </div>
                            </TableCell>
                            {channels.map((c) => {
                              const n = t.channels[c.key] ?? 0
                              return (
                                <TableCell key={c.key} className={styles.chCol}>
                                  <span className={styles.heat} data-level={level(n)} aria-label={`${c.label}: ${n}`}>
                                    {n || '–'}
                                  </span>
                                </TableCell>
                              )
                            })}
                            <TableCell className={styles.numCol}>
                              {t.channelCount} of {channels.length}
                            </TableCell>
                            {hasArr && (
                              <TableCell className={styles.numCol} data-testid={`topic-arr-${t.id}`} title={t.arr !== null ? `${moneyFull(t.arr)}${t.arrUnmatched ? `; ${t.arrUnmatched} of ${t.arrMatched + t.arrUnmatched} accounts not found in Salesforce` : ''}` : undefined}>
                                {t.arr !== null ? money(t.arr) : '–'}
                                {t.arrUnmatched > 0 && <span className={styles.srOnly}>, {t.arrUnmatched} accounts not found in Salesforce</span>}
                              </TableCell>
                            )}
                            {hasPlay && (
                              <TableCell className={styles.numCol} data-testid={`topic-play-${t.id}`}>
                                {t.inPlay && t.inPlay.open.count > 0 ? money(t.inPlay.open.amount) : '–'}
                                {t.inPlay && t.inPlay.open.count > 0 && <span className={styles.srOnly}>, {t.inPlay.open.count} open opportunities</span>}
                                {t.inPlay && t.inPlay.lost.count > 0 && <span className={styles.meta}> · lost {money(t.inPlay.lost.amount)}</span>}
                              </TableCell>
                            )}
                            <TableCell className={styles.numCol} data-testid="topic-score">
                              {t.score}
                            </TableCell>
                            <TableCell className={styles.menuCol}>
                              {canStart && <OverflowMenu size="sm" flipped aria-label={`Actions for ${t.title}`} data-testid={`topic-menu-${t.id}`}>
                                <OverflowMenuItem itemText="Rename" data-testid={`rename-${t.id}`} onClick={() => setRenaming(t)} />
                                <OverflowMenuItem itemText="Merge into another topic" data-testid={`merge-${t.id}`} disabled={list.topics.length < 2} onClick={() => setMerging(t)} />
                                <OverflowMenuItem itemText="Dismiss topic" isDelete hasDivider data-testid={`dismiss-${t.id}`} onClick={() => setDismissing(t)} />
                              </OverflowMenu>}
                            </TableCell>
                          </TableRow>
                          {open === t.id && (
                            <TableRow className={styles.whyRow} data-testid={`why-row-${t.id}`}>
                              <TableCell colSpan={channels.length + 6 + (hasArr ? 1 : 0) + (hasPlay ? 1 : 0)}>
                                <Why topic={t} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                </div>
                </>
              )}
            </TabPanel>
          </TabPanels>
        </Tabs>
        </div>
      )}

      {list && list.unsorted > 0 && (
        <p className={styles.footnote} data-testid="topics-unsorted">
          {plural(list.unsorted, 'kept signal')} {list.unsorted === 1 ? 'is' : 'are'} not in a topic: a signal on its own is not a topic yet.
        </p>
      )}

      {picked.length > 0 && (
        <div className={styles.pickBar} role="region" aria-label="Selected topics" data-testid="pick-bar">
          <p className={styles.pickText}>
            {plural(picked.length, 'topic')} selected · {plural(pickedSignals, 'signal')}
            {!canStart && <span className={styles.pickNote}> · Read-only: starting a project needs an editor</span>}
          </p>
          <Button kind="ghost" size="sm" onClick={clear}>
            Clear
          </Button>
          <Button kind="primary" size="md" data-testid="create-project" disabled={!canStart} onClick={() => setCreating(true)}>
            Create Signal Flow project
          </Button>
        </div>
      )}

      <CreateProjectPanel topics={picked} open={creating && picked.length > 0} onClose={() => setCreating(false)} />
      <AddCallNotes open={adding} onClose={() => setAdding(false)} />
      <DismissModal topic={dismissing} onClose={() => setDismissing(null)} />
      <RenameModal topic={renaming} onClose={() => setRenaming(null)} />
      <MergeModal topic={merging} others={list?.topics.filter((t) => t.id !== merging?.id) ?? []} onClose={() => setMerging(null)} />
    </div>
  )
}

const useTopics = usePulseTopics

function RenameModal({ topic, onClose }: { topic: PulseTopic | null; onClose: () => void }) {
  const rename = useRenamePulseTopic()
  const [title, setTitle] = useState('')
  const [seen, setSeen] = useState<string | null>(null)
  // The box opens with the topic's own name: reset when a different topic is chosen.
  if (topic && seen !== topic.id) {
    setSeen(topic.id)
    setTitle(topic.title)
  }
  if (!topic && seen !== null) setSeen(null)
  const save = async () => {
    if (!topic) return
    try {
      await rename.mutateAsync({ id: topic.id, title })
      onClose()
    } catch {
      /* shown below */
    }
  }
  return (
    <Modal open={!!topic} modalHeading="Rename topic" primaryButtonText={rename.isPending ? 'Saving…' : 'Save'} secondaryButtonText="Cancel" primaryButtonDisabled={!title.trim() || rename.isPending} onRequestClose={onClose} onRequestSubmit={save} size="sm" data-testid="rename-modal">
      <TextInput id="rename-title" data-testid="rename-title" labelText="Topic name" value={title} onChange={(e) => setTitle(e.target.value)} />
      <p className={styles.modalNote}>A topic you rename is left alone when topics are regrouped.</p>
      {rename.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(rename.error)} />}
    </Modal>
  )
}

// Dismissing a topic hides it from everyone, so it asks first, and asks why: the reason (and a comment, required for "Other") is kept so the matching can learn from it. Nothing needs tidying afterwards:
// the signals stay, and the topic comes back by itself if three or more new ones join it.
const REASONS: { key: DismissReason; label: string; hint: string }[] = [
  { key: 'addressed', label: 'Addressed in a release', hint: 'It has been fixed or shipped, so it should stop counting.' },
  { key: 'not_relevant', label: 'Not relevant', hint: 'It is not something this team acts on.' },
  { key: 'duplicate', label: 'Duplicate of another topic', hint: 'It is the same thing as another topic (Merge may fit better).' },
  { key: 'other', label: 'Other', hint: 'Say why in the comment.' },
]
function DismissModal({ topic, onClose }: { topic: PulseTopic | null; onClose: () => void }) {
  const dismiss = useDismissPulseTopic()
  const [reason, setReason] = useState<DismissReason | null>(null)
  const [comment, setComment] = useState('')
  const [seen, setSeen] = useState<string | null>(null)
  // Each topic starts with no reason picked and no comment.
  if (topic && seen !== topic.id) {
    setSeen(topic.id)
    setReason(null)
    setComment('')
    dismiss.reset()
  }
  if (!topic && seen !== null) setSeen(null)
  const needsComment = reason === 'other' && !comment.trim()
  const run = async () => {
    if (!topic || !reason) return
    try {
      await dismiss.mutateAsync({ id: topic.id, reason, comment: comment.trim() || null })
      onClose()
    } catch {
      /* shown below */
    }
  }
  return (
    <Modal open={!!topic} danger modalHeading="Dismiss this topic?" primaryButtonText={dismiss.isPending ? 'Dismissing…' : 'Dismiss topic'} secondaryButtonText="Cancel" primaryButtonDisabled={!reason || needsComment || dismiss.isPending} onRequestClose={onClose} onRequestSubmit={run} data-testid="dismiss-modal">
      <p className={styles.modalNote}>
        “{topic?.title}” leaves the lists for everyone. Its signals are kept, and the topic comes back by itself if three or more new signals join it.
      </p>
      <div role="radiogroup" aria-label="Why is it being dismissed?" className={styles.reasons}>
        <p className={styles.reasonsLabel}>Why is it being dismissed?</p>
        {REASONS.map((r) => (
          <RadioButton key={r.key} id={`dismiss-reason-${r.key}`} data-testid={`dismiss-reason-${r.key}`} name="dismiss-reason" labelText={`${r.label}: ${r.hint}`} value={r.key} checked={reason === r.key} onChange={() => setReason(r.key)} />
        ))}
      </div>
      <TextArea id="dismiss-comment" data-testid="dismiss-comment" labelText={reason === 'other' ? 'Comment (required)' : 'Comment (optional)'} rows={3} maxCount={500} value={comment} invalid={needsComment && comment.length > 0} invalidText="Say why, in a few words." onChange={(e) => setComment(e.target.value)} />
      {dismiss.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not dismissed" subtitle={friendlyMessage(dismiss.error)} />}
    </Modal>
  )
}

function MergeModal({ topic, others, onClose }: { topic: PulseTopic | null; others: PulseTopic[]; onClose: () => void }) {
  const merge = useMergePulseTopic()
  const [target, setTarget] = useState('')
  const chosen = target && others.some((o) => o.id === target) ? target : (others[0]?.id ?? '')
  const save = async () => {
    if (!topic || !chosen) return
    try {
      await merge.mutateAsync({ id: topic.id, intoId: chosen })
      onClose()
    } catch {
      /* shown below */
    }
  }
  return (
    <Modal open={!!topic} modalHeading="Merge into another topic" primaryButtonText={merge.isPending ? 'Merging…' : 'Merge'} secondaryButtonText="Cancel" primaryButtonDisabled={!chosen || merge.isPending} onRequestClose={onClose} onRequestSubmit={save} size="sm" data-testid="merge-modal">
      <p className={styles.modalNote}>All of “{topic?.title}” moves into the topic you choose, and this one goes away.</p>
      <Select id="merge-into" data-testid="merge-into" labelText="Merge into" value={chosen} onChange={(e) => setTarget(e.target.value)}>
        {others.map((o) => (
          <SelectItem key={o.id} value={o.id} text={`${o.title} (${plural(o.signals, 'signal')})`} />
        ))}
      </Select>
      {merge.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not merged" subtitle={friendlyMessage(merge.error)} />}
    </Modal>
  )
}
