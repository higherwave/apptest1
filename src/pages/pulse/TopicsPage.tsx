import { Fragment, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, Checkbox, InlineNotification, Modal, OverflowMenu, OverflowMenuItem, Select, SelectItem, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, Tag, TextInput } from '@carbon/react'
import { Link, useNavigate } from 'react-router-dom'
import { friendlyMessage, type PulseTopic } from '../../api/client'
import { useMe, useMergePulseTopic, usePulseTopics, useRenamePulseTopic, useUpdatePulseTopics } from '../../api/hooks'
import { PageHero } from '../../shell/PageHero'
import { CHANNEL_LABEL, CHANNELS } from './channels'
import { CreateProjectPanel } from './CreateProjectPanel'
import { ImpactMap } from './ImpactMap'
import { PulseNotFound } from './PulseNotFound'
import { useTopicSelection } from './selection'
import styles from './TopicsPage.module.scss'

const TREND: Record<PulseTopic['trend'], { label: string; type: 'red' | 'blue' | 'gray' | 'green' }> = {
  new: { label: 'New', type: 'blue' },
  rising: { label: 'Rising', type: 'red' },
  steady: { label: 'Steady', type: 'gray' },
  fading: { label: 'Fading', type: 'green' },
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null)

// Pulse's default page: what customers keep raising, ranked. Topics are kept signals grouped together; each row says how many were heard in which channel (the numbers are always
// printed, the shading only helps the eye) and, on request, exactly why it ranks where it does. Rankings change only when topics are updated, never while someone is reading.
export function TopicsPage() {
  const me = useMe()
  const topics = useTopics()
  const update = useUpdatePulseTopics()
  const navigate = useNavigate()
  const [open, setOpen] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<PulseTopic | null>(null)
  const [merging, setMerging] = useState<PulseTopic | null>(null)
  const [creating, setCreating] = useState(false)
  const { selected, toggle, clear, keepOnly } = useTopicSelection()
  // A topic that was merged away or regrouped can no longer be picked.
  const validIds = topics.data?.topics.map((t) => t.id)
  useEffect(() => { if (validIds) keepOnly(validIds) }, [validIds?.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!me.data) return null
  if (!me.data.features.pulse) return <PulseNotFound />
  const list = topics.data
  const total = list?.topics.reduce((a, t) => a + t.signals, 0) ?? 0
  const max = Math.max(1, ...(list?.topics.flatMap((t) => CHANNELS.map((c) => t.channels[c.key] ?? 0)) ?? [1]))
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999)))
  const isOwner = me.data.role === 'owner'
  const canStart = me.data.role === 'owner' || me.data.role === 'editor'
  const picked = list?.topics.filter((t) => selected.includes(t.id)) ?? []
  const pickedSignals = picked.reduce((a, t) => a + t.signals, 0)

  return (
    <div className={styles.page}>
      <PageHero title="Topics" description="What customers keep raising, grouped from the signals you have kept and ranked by how much each counts" glow="left">
        <Tag type="purple" size="md" data-testid="pulse-preview-tag">
          Preview · owners only
        </Tag>
      </PageHero>

      <div className={styles.status} data-testid="topics-status">
        <p className={styles.statusText}>
          {list ? `${plural(list.topics.length, 'topic')} from ${plural(total, 'kept signal')}` : 'Loading topics…'}
          {list?.updatedAt ? ` · updated ${when(list.updatedAt)}` : list ? ' · not updated yet' : ''}
        </p>
        <Button kind="tertiary" size="sm" data-testid="topics-update" disabled={update.isPending} onClick={() => update.mutate('attach')}>
          {update.isPending ? 'Updating…' : 'Update topics'}
        </Button>
      </div>

      {topics.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Topics could not be loaded" subtitle={friendlyMessage(topics.error)} />}
      {update.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Topics were not updated" subtitle={friendlyMessage(update.error)} />}

      {list && (list.toReview > 0 || list.sinceUpdate > 0) && (
        <ul className={styles.notes} aria-label="Waiting">
          {list.toReview > 0 && (
            <li data-testid="topics-review">
              {plural(list.toReview, 'signal')} {list.toReview === 1 ? 'is' : 'are'} waiting for review and not counted yet.{' '}
              <Button kind="ghost" size="sm" onClick={() => navigate('/pulse/signals')}>
                Review signals
              </Button>
            </li>
          )}
          {list.sinceUpdate > 0 && (
            <li data-testid="topics-since">
              {plural(list.sinceUpdate, 'signal')} kept since topics were last updated. Topics also update by themselves every hour.
            </li>
          )}
        </ul>
      )}

      {list && !list.topics.length && (
        <section className={styles.empty} data-testid="topics-empty">
          <p className={styles.text}>No topics yet. Topics form when at least two kept signals are about the same thing. Keep some signals, then update topics.</p>
          <div className={styles.emptyActions}>
            <Button kind="primary" size="md" disabled={update.isPending} onClick={() => update.mutate('regroup')}>
              Update topics
            </Button>
            <Button kind="ghost" size="md" onClick={() => navigate('/pulse/signals')}>
              Go to signals
            </Button>
          </div>
        </section>
      )}

      {list && list.topics.length > 0 && (
        <section className={styles.mapSection} aria-label="Impact map">
          <h2 className={styles.mapHead}>Impact map</h2>
          <p className={styles.text}>Topics heard in more channels by more accounts sit higher and further right; a bigger circle is more signals. Choose circles (or rows below) to start a project from them.</p>
          <ImpactMap topics={list.topics} selected={selected} onToggle={toggle} />
        </section>
      )}

      {list && list.topics.length > 0 && (
        <TableContainer title="Where topics were heard" description="Signals per channel. Darker means more. Open “Why it ranks here” to see the weights behind the score." className={styles.table}>
          <Table size="lg" aria-label="Topics by channel" data-testid="topics-grid">
            <TableHead>
              <TableRow>
                <TableHeader className={styles.checkCol}>
                  <span className={styles.srOnly}>Select</span>
                </TableHeader>
                <TableHeader className={styles.rankCol}>#</TableHeader>
                <TableHeader>Topic</TableHeader>
                {CHANNELS.map((c) => (
                  <TableHeader key={c.key} className={styles.chCol}>
                    {c.label}
                  </TableHeader>
                ))}
                <TableHeader className={styles.numCol}>Heard in</TableHeader>
                <TableHeader className={styles.numCol}>Score</TableHeader>
                <TableHeader className={styles.menuCol}>
                  <span className={styles.srOnly}>Actions</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.topics.map((t) => (
                <Fragment key={t.id}>
                  <TableRow data-testid={`topic-${t.id}`} data-rank={t.rank}>
                    <TableCell className={styles.checkCol}>
                      <Checkbox id={`pick-${t.id}`} data-testid={`pick-${t.id}`} labelText={`Select ${t.title}`} hideLabel checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                    </TableCell>
                    <TableCell className={styles.rankCol}>{t.rank}</TableCell>
                    <TableCell>
                      <div className={styles.topic}>
                        <Link to={`/pulse/topics/${t.id}`} className={styles.title} data-testid="topic-title">
                          {t.title}
                        </Link>
                        <span className={styles.meta}>
                          {plural(t.signals, 'signal')} · {plural(t.reach, 'account')}
                          <Tag type={TREND[t.trend].type} size="sm">
                            {TREND[t.trend].label}
                          </Tag>
                        </span>
                        <Button kind="ghost" size="sm" className={styles.why} renderIcon={open === t.id ? ChevronUp : ChevronDown} aria-expanded={open === t.id} data-testid={`why-${t.id}`} onClick={() => setOpen(open === t.id ? null : t.id)}>
                          Why it ranks here
                        </Button>
                      </div>
                    </TableCell>
                    {CHANNELS.map((c) => {
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
                      {t.channelCount} of {CHANNELS.length}
                    </TableCell>
                    <TableCell className={styles.numCol} data-testid="topic-score">
                      {t.score}
                    </TableCell>
                    <TableCell className={styles.menuCol}>
                      <OverflowMenu size="sm" flipped aria-label={`Actions for ${t.title}`} data-testid={`topic-menu-${t.id}`}>
                        <OverflowMenuItem itemText="Rename" data-testid={`rename-${t.id}`} onClick={() => setRenaming(t)} />
                        <OverflowMenuItem itemText="Merge into another topic" data-testid={`merge-${t.id}`} disabled={list.topics.length < 2} onClick={() => setMerging(t)} />
                      </OverflowMenu>
                    </TableCell>
                  </TableRow>
                  {open === t.id && (
                    <TableRow className={styles.whyRow} data-testid={`why-row-${t.id}`}>
                      <TableCell colSpan={CHANNELS.length + 6}>
                        <Why topic={t} isOwner={isOwner} onEdit={() => navigate('/settings/pulse')} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
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
      <RenameModal topic={renaming} onClose={() => setRenaming(null)} />
      <MergeModal topic={merging} others={list?.topics.filter((t) => t.id !== merging?.id) ?? []} onClose={() => setMerging(null)} />
    </div>
  )
}

const useTopics = usePulseTopics

function Why({ topic, isOwner, onEdit }: { topic: PulseTopic; isOwner: boolean; onEdit: () => void }) {
  return (
    <div className={styles.whyBox}>
      <p className={styles.whyIntro}>
        “{topic.title}” ranks #{topic.rank} because its {plural(topic.signals, 'kept signal')} count for different amounts depending on where they were heard. The score is the total of signals × weight, channel by channel.
      </p>
      <dl className={styles.sum}>
        {topic.breakdown.map((b) => (
          <div key={b.channel} className={styles.sumRow}>
            <dt>{CHANNEL_LABEL[b.channel]}</dt>
            <dd>
              {b.count} × {b.weight} = {b.subtotal}
            </dd>
          </div>
        ))}
        <div className={styles.sumTotal}>
          <dt>Score</dt>
          <dd>{topic.score}</dd>
        </div>
      </dl>
      {isOwner && (
        <Button kind="ghost" size="sm" onClick={onEdit}>
          Edit weights
        </Button>
      )}
    </div>
  )
}

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
