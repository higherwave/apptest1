import type { KeyboardEvent } from 'react'
import type { PulseTopic } from '../../api/client'
import { CHANNELS } from './channels'
import { money, moneyFull } from './money'
import styles from './ImpactMap.module.scss'

const W = 1100
const H = 360
const PAD = { left: 72, right: 24, top: 24, bottom: 48 }

const short = (s: string, n = 26) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// The impact map: how widely each topic was heard (across channels, left to right) against how many accounts raised it (bottom to top); the bubble's size is its number of signals.
// Each bubble is a checkbox for picking topics to start a project from. The grid below carries the same numbers for anyone who does not use the picture.
export type MapBy = 'accounts' | 'arr'

/** Round tick steps for an ARR axis: about four lines, at 1, 2 or 5 times a power of ten. */
function arrTicks(max: number): number[] {
  const raw = Math.max(max, 1) / 4
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * pow).find((v) => v >= raw)!
  const out: number[] = []
  for (let v = 0; v <= max + step * 0.5; v += step) out.push(v)
  return out
}

// With Salesforce connected the height can be the ARR of the accounts behind a topic (`by="arr"`) instead of their number.
export function ImpactMap({ topics, selected, onToggle, by = 'accounts' }: { topics: PulseTopic[]; selected: string[]; onToggle: (id: string) => void; by?: MapBy }) {
  const value = (t: PulseTopic) => (by === 'arr' ? (t.arr ?? 0) : t.reach)
  const ticks = by === 'arr' ? arrTicks(Math.max(...topics.map(value), 1)) : Array.from({ length: Math.max(2, ...topics.map((t) => t.reach)) + 1 }, (_, i) => i)
  const maxReach = ticks[ticks.length - 1]
  const x = (n: number) => PAD.left + ((n - 0.5) / CHANNELS.length) * (W - PAD.left - PAD.right)
  const y = (n: number) => H - PAD.bottom - (n / (by === 'arr' ? maxReach : maxReach + 0.5)) * (H - PAD.top - PAD.bottom)
  const r = (n: number) => 12 + Math.sqrt(n) * 5
  // Two topics with the same numbers would sit on top of each other. They are placed side by side at that height (their names on the outer sides), so the height, which
  // is the number of accounts, stays true; a third or later is lifted a little.
  const groups = new Map<string, PulseTopic[]>()
  for (const t of topics) groups.set(`${t.channelCount}:${value(t)}`, [...(groups.get(`${t.channelCount}:${value(t)}`) ?? []), t])
  const placed = topics.map((t) => {
    const group = groups.get(`${t.channelCount}:${value(t)}`)!
    const i = group.indexOf(t)
    const side: 'left' | 'right' = group.length > 1 && i === 0 ? 'left' : 'right'
    const nudge = group.length > 1 && i < 2 ? (i === 0 ? -1 : 1) * (r(t.signals) + 6) : 0
    return { t, side, cx: x(t.channelCount) + nudge, cy: y(value(t)) - Math.max(0, i - 1) * 40 }
  })
  const onKey = (id: string) => (e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      onToggle(id)
    }
  }
  return (
    <figure className={styles.figure} data-testid="impact-map">
      <svg viewBox={`0 0 ${W} ${H}`} className={styles.svg} role="group" aria-label={`Impact map: topics by how many channels they were heard in and ${by === 'arr' ? 'the ARR of the accounts that raised them' : 'how many accounts raised them'}`}>
        <line className={styles.axis} x1={PAD.left} y1={H - PAD.bottom} x2={W - PAD.right} y2={H - PAD.bottom} />
        <line className={styles.axis} x1={PAD.left} y1={PAD.top} x2={PAD.left} y2={H - PAD.bottom} />
        {CHANNELS.map((_, i) => (
          <g key={i}>
            <line className={styles.grid} x1={x(i + 1)} y1={PAD.top} x2={x(i + 1)} y2={H - PAD.bottom} />
            <text className={styles.tick} x={x(i + 1)} y={H - PAD.bottom + 18} textAnchor="middle">
              {i + 1}
            </text>
          </g>
        ))}
        {ticks.map((i) => (
          <g key={i}>
            <line className={styles.grid} x1={PAD.left} y1={y(i)} x2={W - PAD.right} y2={y(i)} />
            <text className={styles.tick} x={PAD.left - 10} y={y(i) + 4} textAnchor="end">
              {by === 'arr' ? money(i) : i}
            </text>
          </g>
        ))}
        <text className={styles.axisLabel} x={(PAD.left + W - PAD.right) / 2} y={H - 8} textAnchor="middle">
          Channels it was heard in →
        </text>
        <text className={styles.axisLabel} transform={`translate(14 ${(PAD.top + H - PAD.bottom) / 2}) rotate(-90)`} textAnchor="middle">
          {by === 'arr' ? 'ARR of the accounts raising it →' : 'Accounts raising it →'}
        </text>
        <text className={styles.corner} x={W - PAD.right - 4} y={PAD.top + 12} textAnchor="end">
          Broad and deep
        </text>
        <text className={styles.corner} x={PAD.left + 6} y={H - PAD.bottom - 8}>
          Narrow
        </text>
        {placed.map(({ t, cx, cy, side }) => {
          const on = selected.includes(t.id)
          return (
            <g
              key={t.id}
              className={styles.bubble}
              data-selected={on}
              data-testid={`bubble-${t.id}`}
              role="checkbox"
              aria-checked={on}
              aria-label={`${t.title}: ${t.signals} signals, heard in ${t.channelCount} of ${CHANNELS.length} channels, ${t.reach} ${t.reach === 1 ? 'account' : 'accounts'}${t.arr !== null ? `, ${moneyFull(t.arr)} ARR` : ''}`}
              tabIndex={0}
              onClick={() => onToggle(t.id)}
              onKeyDown={onKey(t.id)}
            >
              <circle cx={cx} cy={cy} r={r(t.signals)} />
              <text className={styles.count} x={cx} y={cy + 5} textAnchor="middle">
                {t.signals}
              </text>
              <text className={styles.label} x={side === 'left' ? cx - r(t.signals) - 8 : cx + r(t.signals) + 8} y={cy + 4} textAnchor={side === 'left' ? 'end' : 'start'}>
                {short(t.title)}
              </text>
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
