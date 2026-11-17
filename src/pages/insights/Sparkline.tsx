import styles from './Sparkline.module.scss'

// Two small charts of how something moved over time, oldest first. Neither is a measurement; the words (Growing, Steady, Fading, New, or the readings) are the
// accessible name and the hover note, so nothing is carried by the shape alone.
//
//   bars  (24 by 24, the Trend column): one bar per project, from zero, so the heights are honest; the latest bar takes the trend's colour and the earlier ones
//         are a quiet tint of it.
//   area  (64 by 64, a Measure card): the readings as a line over a soft fill, scaled to their own highest and lowest points, a faint middle line to read against,
//         and the latest reading marked with a ringed dot.
type Props = { values: number[]; trend: 'new' | 'growing' | 'steady' | 'fading'; label: string; note: string; variant?: 'bars' | 'area' }

export function Sparkline({ values, trend, label, note, variant = 'bars' }: Props) {
  if (values.length < 2) return null
  return variant === 'area' ? <Area values={values} trend={trend} label={label} note={note} /> : <Bars values={values} trend={trend} label={label} note={note} />
}

function Bars({ values, trend, label, note }: Omit<Props, 'variant'>) {
  const W = 24
  const H = 24
  const PAD = 2
  const GAP = 1.5
  const shown = values.slice(-8)
  const max = Math.max(...shown, Number.MIN_VALUE)
  const width = (W - 2 * PAD - (shown.length - 1) * GAP) / shown.length
  const base = H - PAD
  return (
    <svg className={styles.bars} data-trend={trend} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{note}</title>
      <line className={styles.base} x1={PAD} x2={W - PAD} y1={base + 0.5} y2={base + 0.5} />
      {shown.map((v, i) => {
        const h = Math.max(2, (v / max) * (H - 2 * PAD))
        return <rect key={i} className={i === shown.length - 1 ? styles.barNow : styles.bar} x={PAD + i * (width + GAP)} y={base - h} width={width} height={h} rx={1} />
      })}
    </svg>
  )
}

function Area({ values, trend, label, note }: Omit<Props, 'variant'>) {
  const W = 64
  const H = 64
  const PAD = 8
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (values.length - 1)
  const y = (v: number) => (hi === lo ? H / 2 : H - PAD - 4 - ((v - lo) / (hi - lo)) * (H - 2 * PAD - 8))
  const pts = values.map((v, i) => [x(i), y(v)] as const)
  const line = pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ')
  const base = H - PAD
  const area = `M${pts[0][0].toFixed(1)},${base} L${line.replace(/ /g, ' L')} L${pts[pts.length - 1][0].toFixed(1)},${base} Z`
  const [lx, ly] = pts[pts.length - 1]
  return (
    <svg className={styles.area} data-trend={trend} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      <title>{note}</title>
      <line className={styles.grid} x1={PAD} x2={W - PAD} y1={H / 2} y2={H / 2} />
      <line className={styles.base} x1={PAD} x2={W - PAD} y1={base} y2={base} />
      <path className={styles.fill} d={area} />
      <polyline className={styles.line} points={line} />
      <circle className={styles.ring} cx={lx} cy={ly} r={5} />
      <circle className={styles.dot} cx={lx} cy={ly} r={2.75} />
    </svg>
  )
}
