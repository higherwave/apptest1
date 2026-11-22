import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, Checkbox, Select, SelectItem, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tag } from '@carbon/react'
import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PulseTopic, SignalOrigin } from '../../api/client'
import { usePulseTopic, usePulseTopics } from '../../api/hooks'
import { CHANNEL_LABEL, CHANNELS } from './channels'
import { CreateProjectPanel } from './CreateProjectPanel'
import { money, moneyFull, oppLine } from './money'
import { useTopicSelection } from './selection'
import styles from './SignalTopics.module.scss'

const TREND: Record<PulseTopic['trend'], { label: string; type: 'red' | 'blue' | 'gray' | 'green' }> = {
  new: { label: 'New', type: 'blue' },
  rising: { label: 'Rising', type: 'red' },
  steady: { label: 'Steady', type: 'gray' },
  fading: { label: 'Fading', type: 'green' },
}
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
type SortKey = 'score' | 'arr' | 'play'

// What was heard, by topic, for one view of Signals. Each row is a topic with where it was heard, the accounts behind it (with their ARR once Salesforce is copied), its trend and its quotes,
// which open in place. Picking topics (editors) gathers them at the foot, with the ARR in scope, ready to start a Signal Flow project from them.
export function SignalTopics({ origin, canEdit }: { origin?: SignalOrigin; canEdit: boolean }) {
  const view = origin ?? 'all'
  const topics = usePulseTopics(true, origin)
  const { selected, toggle, clear } = useTopicSelection()
  const [open, setOpen] = useState<string[]>([])
  const [sort, setSort] = useState<SortKey>('score')
  const [creating, setCreating] = useState(false)
  const list = topics.data?.topics ?? []
  const hasArr = list.some((t) => t.arr !== null)
  const hasPlay = list.some((t) => t.inPlay)
  const playOf = (t: PulseTopic) => t.inPlay?.open.amount ?? 0
  const ordered = [...list].sort((a, b) => {
    const by = sort === 'arr' && hasArr ? (b.arr ?? 0) - (a.arr ?? 0) : sort === 'play' && hasPlay ? playOf(b) - playOf(a) : 0
    return by || a.rank - b.rank
  })
  const picked = list.filter((t) => selected.includes(t.id))
  // The ARR in scope counts each account once, however many of the picked topics it raised.
  const inScope = new Map<string, number>()
  for (const t of picked) for (const a of t.accounts) if (a.arr !== null) inScope.set(a.name.trim().toLowerCase(), a.arr)
  const arrInScope = [...inScope.values()].reduce((n, v) => n + v, 0)
  const isOpen = (id: string, part: 'a' | 'q') => open.includes(`${id}:${part}`)
  const flip = (id: string, part: 'a' | 'q') => setOpen((o) => (o.includes(`${id}:${part}`) ? o.filter((x) => x !== `${id}:${part}`) : [...o, `${id}:${part}`]))
  const columns = (canEdit ? 1 : 0) + 5 + (hasArr ? 1 : 0) + (hasPlay ? 1 : 0)

  return (
    <section className={styles.topics} aria-label="Topics" data-testid={`topics-${view}`}>
      <div className={styles.head}>
        <h2 className={styles.sectionTitle}>{list.length ? `${plural(list.length, 'topic')}` : 'Topics'}</h2>
        {(hasArr || hasPlay) && (
          <Select id={`sort-${view}`} data-testid={`sort-${view}`} size="sm" inline labelText="Sort by" value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
            <SelectItem value="score" text="Signal score" />
            {hasArr && <SelectItem value="arr" text="ARR" />}
            {hasPlay && <SelectItem value="play" text="In play" />}
          </Select>
        )}
      </div>

      {topics.isSuccess && !list.length && (
        <p className={styles.empty} data-testid={`topics-empty-${view}`}>
          {origin === 'auto'
            ? 'No topics from what Pulse finds yet. When a Slack channel or opportunity notes bring in signals that are kept, and two are about the same thing, a topic forms here.'
            : origin === 'manual'
              ? 'No topics from notes and signals added by hand yet. Keep some, and when two are about the same thing a topic forms here.'
              : 'No topics yet. Keep some signals, and when two are about the same thing a topic forms here.'}
        </p>
      )}

      {list.length > 0 && (
        <Table size="lg" aria-label={`Topics, ${origin === 'auto' ? 'found by Pulse' : origin === 'manual' ? 'added by hand' : 'from every source'}`} data-testid={`topic-table-${view}`}>
          <TableHead>
            <TableRow>
              {canEdit && (
                <TableHeader className={styles.checkCol}>
                  <span className={styles.srOnly}>Select</span>
                </TableHeader>
              )}
              <TableHeader>Topic</TableHeader>
              <TableHeader className={styles.num}>Accounts</TableHeader>
              {hasArr && <TableHeader className={styles.num}>ARR</TableHeader>}
              {hasPlay && <TableHeader className={styles.num}>In play</TableHeader>}
              <TableHeader>Trend</TableHeader>
              <TableHeader className={styles.num}>Evidence</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody>
            {ordered.map((t) => (
              <Fragment key={t.id}>
                <TableRow data-testid={`sig-topic-${t.id}`} data-selected={selected.includes(t.id)}>
                  {canEdit && (
                    <TableCell className={styles.checkCol}>
                      <Checkbox id={`sig-pick-${view}-${t.id}`} data-testid={`sig-pick-${t.id}`} labelText={`Select ${t.title}`} hideLabel checked={selected.includes(t.id)} onChange={() => toggle(t.id)} />
                    </TableCell>
                  )}
                  <TableCell>
                    <div className={styles.topic}>
                      <Link to={`/pulse/topics/${t.id}`} className={styles.title} data-testid="sig-topic-title">
                        {t.title}
                      </Link>
                      <span className={styles.chips}>
                        {CHANNELS.filter((c) => t.channels[c.key]).map((c) => (
                          <Tag key={c.key} size="sm" type="gray">
                            {c.label} {t.channels[c.key]}
                          </Tag>
                        ))}
                        {t.researched.length > 0 && (
                          <Tag size="sm" type="teal">
                            Researched
                          </Tag>
                        )}
                        {t.projects.length > 0 && (
                          <Tag size="sm" type="cyan">
                            {plural(t.projects.length, 'project')}
                          </Tag>
                        )}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={styles.num}>
                    {t.accounts.length ? (
                      <Button kind="ghost" size="sm" className={styles.linkButton} renderIcon={isOpen(t.id, 'a') ? ChevronUp : ChevronDown} aria-expanded={isOpen(t.id, 'a')} data-testid={`sig-accounts-${t.id}`} onClick={() => flip(t.id, 'a')}>
                        {t.accounts.length}
                      </Button>
                    ) : (
                      '–'
                    )}
                  </TableCell>
                  {hasArr && <TableCell className={styles.num}>{t.arr !== null ? money(t.arr) : '–'}</TableCell>}
                  {hasPlay && <TableCell className={styles.num}>{t.inPlay && t.inPlay.open.count > 0 ? money(t.inPlay.open.amount) : '–'}</TableCell>}
                  <TableCell>
                    <Tag type={TREND[t.trend].type} size="sm">
                      {TREND[t.trend].label}
                    </Tag>
                  </TableCell>
                  <TableCell className={styles.num}>
                    <Button kind="ghost" size="sm" className={styles.linkButton} renderIcon={isOpen(t.id, 'q') ? ChevronUp : ChevronDown} aria-expanded={isOpen(t.id, 'q')} data-testid={`sig-quotes-${t.id}`} onClick={() => flip(t.id, 'q')}>
                      {plural(t.signals, 'quote')}
                    </Button>
                  </TableCell>
                </TableRow>
                {isOpen(t.id, 'a') && (
                  <TableRow className={styles.expanded} data-testid={`sig-accounts-row-${t.id}`}>
                    <TableCell colSpan={columns}>
                      <div className={styles.accounts}>
                        <p className={styles.accountsHead}>
                          {plural(t.accounts.length, 'account')} raising this topic <span className={styles.muted}>· possible research participants</span>
                        </p>
                        <ul className={styles.accountList}>
                          {t.accounts.map((a) => (
                            <li key={a.name}>
                              <span className={styles.accountName}>{a.name}</span>
                              <span>{a.arr !== null ? `${moneyFull(a.arr)} ARR` : hasArr ? 'ARR not found' : ''}</span>
                              <span className={styles.muted}>{plural(a.signals, 'mention')}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {isOpen(t.id, 'q') && (
                  <TableRow className={styles.expanded} data-testid={`sig-quotes-row-${t.id}`}>
                    <TableCell colSpan={columns}>
                      <Evidence id={t.id} origin={origin} />
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}

      {canEdit && list.length > 0 && (
        <div className={styles.footer} role="region" aria-label="Start a project" data-testid={`sig-footer-${view}`}>
          <p className={styles.footerText} data-testid="sig-selected">
            {plural(picked.length, 'topic')} selected{arrInScope > 0 ? ` · ${money(arrInScope)} ARR in scope` : ''}
          </p>
          {picked.length > 0 && (
            <Button kind="ghost" size="md" onClick={clear}>
              Clear
            </Button>
          )}
          <Button kind="primary" size="md" data-testid={`sig-create-${view}`} disabled={!picked.length} onClick={() => setCreating(true)}>
            Create Signal Flow project
          </Button>
        </div>
      )}
      <CreateProjectPanel topics={picked} open={creating && picked.length > 0} onClose={() => setCreating(false)} />
    </section>
  )
}

// A topic's quotes, as cards: what was said, where it was heard, who said it and when, and the opportunity behind it for Salesforce notes.
function Evidence({ id, origin }: { id: string; origin?: SignalOrigin }) {
  const detail = usePulseTopic(id, origin)
  if (detail.isPending) return <p className={styles.muted}>Loading quotes…</p>
  if (detail.isError || !detail.data) return <p className={styles.muted}>The quotes could not be loaded.</p>
  return (
    <ul className={styles.quotes} aria-label="Quotes">
      {detail.data.quotes.map((q) => (
        <li key={q.id} className={styles.quote} data-testid="sig-quote">
          <p className={styles.quoteText}>“{q.body}”</p>
          <p className={styles.quoteMeta}>
            <Tag size="sm" type="gray">
              {CHANNEL_LABEL[q.channel]}
            </Tag>
            <span>{[q.saidBy, q.account, q.occurredOn].filter(Boolean).join(' · ')}</span>
          </p>
          {q.opportunity && <p className={styles.quoteMeta}>{oppLine(q.opportunity)}</p>}
        </li>
      ))}
    </ul>
  )
}
