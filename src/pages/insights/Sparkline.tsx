import styles from './Sparkline.module.scss'

const W = 64
const H = 20
const PAD = 3

// A tiny line chart of how a theme's reach moved from project to project, oldest first. It is a shape, not a measurement: the line is
// scaled to its own highest and lowest points, the last point is marked, and the words (Growing, Steady, Fading, New) are the accessible
// name and the hover note, so nothing is carried by the line alone.
export function Sparkline({ values, trend, label, note }: { values: number[]; trend: 'new' | 'growing' | 'steady' | 'fading'; label: string; note: string }) {
  if (values.length < 2) return null
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (values.length - 1)
  const y = (v: number) => (hi === lo ? H / 2 : H - PAD - ((v - lo) / (hi - lo)) * (H - 2 * PAD))
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`)
  const last = values.length - 1
  return (
    <svg className={styles.spark} data-trend={trend} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{note}</title>
      <polyline className={styles.line} points={points.join(' ')} />
      <circle className={styles.dot} cx={x(last)} cy={y(values[last])} r={2.5} />
    </svg>
  )
}
