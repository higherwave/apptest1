import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, Checkbox, Tag } from '@carbon/react'
import { Link } from 'react-router-dom'
import type { PulseTopic } from '../../api/client'
import { activeChannels } from './channels'
import { money } from './money'
import { trendTag } from './trend'
import styles from './TopPriorities.module.scss'
import { Why } from './Why'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const short = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// The map's drawing area, in its own units (the picture scales to the width it is given).
const W = 840
const H = 600
const PAD = { left: 64, right: 16, top: 16, bottom: 16 }
const PLOT_W = W - PAD.left - PAD.right
const PLOT_H = H - PAD.top - PAD.bottom

// Top Priorities: the topics ranked as cards on the left, and the impact map beside them. A dot and its card are one thing: choosing either opens the card, and an open card
// darkens its dot. With Salesforce connected the height is the ARR behind a topic and the size is its accounts; without it the height is accounts and the size is signals.
export function TopPriorities({ rankBar, topics, allTopics, ordered, hasArr, canStart, selected, onToggle, onDismiss }: {
  rankBar: ReactNode
  topics: PulseTopic[]
  /** Every topic, so the channels shown are the same as in the table whatever the top few hold. */
  allTopics: PulseTopic[]
  ordered: PulseTopic[]
  hasArr: boolean
  canStart: boolean
  selected: string[]
  onToggle: (id: string) => void
  onDismiss: (topic: PulseTopic) => void
}) {
  const [open, setOpen] = useState<string[]>([])
  const channels = activeChannels(allTopics)
  const max = Math.max(1, ...topics.flatMap((t) => channels.map((c) => t.channels[c.key] ?? 0)))
  const level = (n: number) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999)))
  const maxSignals = Math.max(1, ...topics.map((t) => t.signals))
  const height = (t: PulseTopic) => (hasArr ? (t.arr ?? 0) : t.reach)
  const maxHeight = Math.max(1, ...topics.map(height))
  const size = (t: PulseTopic) => 12 + (hasArr ? t.reach : t.signals) * 2.4
  const toggle = (id: string) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]))
  // Choosing a dot opens its card, and brings the card into view if it is off screen.
  const pick = (id: string) => {
    if (open.includes(id)) return toggle(id)
    setOpen((o) => [...o, id])
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-testid="card-${id}"]`)
      if (!el) return
      const r = el.getBoundingClientRect()
      if (r.top < 80 || r.bottom > window.innerHeight - 16) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }
  const onKey = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      fn()
    }
  }
  const px = (t: PulseTopic) => PAD.left + (0.08 + (t.signals / maxSignals) * 0.7) * PLOT_W
  const py = (t: PulseTopic) => PAD.top + PLOT_H - (0.08 + (height(t) / maxHeight) * 0.8) * PLOT_H
  const midX = PAD.left + PLOT_W / 2
  const midY = PAD.top + PLOT_H / 2
  const unit = (t: PulseTopic) => (hasArr ? `${t.arr !== null ? money(t.arr) : '–'} ARR` : plural(t.reach, 'account'))

  return (
    <div className={styles.layout} data-testid="top-priorities">
      <div className={styles.listCol}>
      {rankBar}
      <ol className={styles.cards} aria-label="Topics, highest score first">
        {ordered.map((t) => {
          const on = open.includes(t.id)
          return (
            <li key={t.id} className={styles.card} data-open={on} data-testid={`card-${t.id}`} data-rank={t.rank}>
              <div className={styles.head}>
                <span className={styles.pick}><Checkbox id={`card-pick-${t.id}`} data-testid={`card-pick-${t.id}`} labelText={`Select ${t.title}`} hideLabel checked={selected.includes(t.id)} onChange={() => onToggle(t.id)} /></span>
                <Button kind="ghost" className={styles.headMain} aria-expanded={on} data-testid={`card-toggle-${t.id}`} onClick={() => toggle(t.id)}>
                  <span className={styles.title}>{t.title}</span>
                  <span className={styles.meta}>
                    Score {t.score} · {unit(t)}
                  </span>
                  <span className={styles.tags}>
                    <Tag type={trendTag(t).type} size="sm">
                      {trendTag(t).label}
                    </Tag>
                    {t.researched.length > 0 && (
                      <Tag type="teal" size="sm">
                        Researched
                      </Tag>
                    )}
                    {t.projects.length > 0 && (
                      <Tag type="cyan" size="sm">
                        {plural(t.projects.length, 'project')}
                      </Tag>
                    )}
                  </span>
                </Button>
                <span className={styles.chev} aria-hidden="true">
                  {on ? <ChevronUp /> : <ChevronDown />}
                </span>
              </div>
              {on && (
                <div className={styles.body}>
                  <div className={styles.sources}>
                    <p className={styles.sourcesHead}>
                      <span>Sources</span>
                      <strong>
                        Heard in {t.channelCount} of {channels.length}
                      </strong>
                    </p>
                    <div className={styles.cells}>
                      {channels.map((c) => {
                        const n = t.channels[c.key] ?? 0
                        return (
                          <div key={c.key} className={styles.cell}>
                            <span className={styles.heat} data-level={level(n)} aria-label={`${c.label}: ${n}`}>
                              {n || '–'}
                            </span>
                            <span className={styles.cellLabel}>{c.label}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                  <div className={styles.whyWrap}>
                    <Why topic={t} />
                  </div>
                  <div className={styles.actions}>
                    <Link to={`/pulse/topics/${t.id}`} className={styles.open}>
                      Open topic
                    </Link>
                    {canStart && (
                      <Button kind="ghost" size="sm" data-testid={`card-dismiss-${t.id}`} onClick={() => onDismiss(t)}>
                        Dismiss topic
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ol>
      </div>

      <section className={styles.mapPanel} aria-label="Impact map">
        <div className={styles.mapHead}>
          <h2 className={styles.mapTitle}>Impact map</h2>
          <p className={styles.mapNote}>Bubble size = {hasArr ? 'accounts' : 'signals'}</p>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="group" aria-label={`Impact map: each topic by its signals (across) and ${hasArr ? 'the ARR behind it' : 'its accounts'} (up)`} data-testid="impact-map">
          <rect className={styles.qQuietCostly} x={PAD.left} y={PAD.top} width={PLOT_W / 2} height={PLOT_H / 2} />
          <rect className={styles.qLoudCostly} x={midX} y={PAD.top} width={PLOT_W / 2} height={PLOT_H / 2} />
          <rect className={styles.qQuietContained} x={PAD.left} y={midY} width={PLOT_W / 2} height={PLOT_H / 2} />
          <rect className={styles.qLoudContained} x={midX} y={midY} width={PLOT_W / 2} height={PLOT_H / 2} />
          <line className={styles.divider} x1={midX} y1={PAD.top} x2={midX} y2={PAD.top + PLOT_H} />
          <line className={styles.divider} x1={PAD.left} y1={midY} x2={PAD.left + PLOT_W} y2={midY} />
          <line className={styles.axis} x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={PAD.top + PLOT_H} />
          <line className={styles.axis} x1={PAD.left} y1={PAD.top + PLOT_H} x2={PAD.left + PLOT_W} y2={PAD.top + PLOT_H} />
          <text className={`${styles.quad} ${styles.quadCostly}`} x={PAD.left + 8} y={PAD.top + 20}>Quiet &amp; costly</text>
          <text className={`${styles.quad} ${styles.quadCostly}`} x={W - PAD.right - 8} y={PAD.top + 20} textAnchor="end">Loud &amp; costly</text>
          <text className={`${styles.quad} ${styles.quadContained}`} x={PAD.left + 8} y={PAD.top + PLOT_H - 10}>Quiet &amp; contained</text>
          <text className={`${styles.quad} ${styles.quadContained}`} x={W - PAD.right - 8} y={PAD.top + PLOT_H - 10} textAnchor="end">Loud &amp; contained</text>
          <text className={styles.axisLabel} transform={`translate(16 ${PAD.top + PLOT_H / 2}) rotate(-90)`} textAnchor="middle">
            {hasArr ? 'ARR at risk →' : 'Accounts raising it →'}
          </text>
          {topics.map((t) => {
            const on = open.includes(t.id)
            const r = size(t)
            const x = px(t)
            const right = x > PAD.left + PLOT_W * 0.7
            return (
              <g key={t.id} className={styles.dot} data-active={on} data-testid={`bubble-${t.id}`} role="button" tabIndex={0} aria-expanded={on} aria-label={`${t.title}: ${t.signals} signals, ${unit(t)}. Opens its card.`} onClick={() => pick(t.id)} onKeyDown={onKey(() => pick(t.id))}>
                <circle cx={x} cy={py(t)} r={r} />
                <text className={styles.dotName} x={right ? x - r - 8 : x + r + 8} y={py(t) - 2} textAnchor={right ? 'end' : 'start'}>
                  {short(t.title)}
                </text>
                <text className={styles.dotMeta} x={right ? x - r - 8 : x + r + 8} y={py(t) + 14} textAnchor={right ? 'end' : 'start'}>
                  {unit(t)} · {plural(t.signals, 'signal')}
                </text>
              </g>
            )
          })}
        </svg>
      </section>
    </div>
  )
}
