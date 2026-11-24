import styles from './PageHero.module.scss'

// The picture for Pulse's title regions: six thin strands (mint, teal, sky, blue, violet, lilac) that follow the same heartbeat, each a little out of step, so they weave together and
// apart. It matches the Pulse logo. A picture only (hidden from assistive tech, never takes clicks); drawn once, still. The curve and the offsets come from the design file.
const WIDTH = 1000
const HEIGHT = 240
const BEATS = 1.8
const TIME = 5 // the moment the still picture is drawn at

// One heartbeat over 0..1: flat, a small P wave, a sharp spike up, a deep drop, a T wave, flat.
const KEYS: [number, number][] = [[0, 0], [0.26, 0], [0.29, 0.05], [0.32, 0.09], [0.35, 0.05], [0.38, 0], [0.44, 0], [0.46, -0.12], [0.495, 1], [0.535, -0.55], [0.565, 0], [0.63, 0], [0.66, 0.1], [0.7, 0.17], [0.74, 0.1], [0.78, 0], [1, 0]]

function beat(u: number): number {
  const t = ((u % 1) + 1) % 1
  for (let i = 0; i < KEYS.length - 1; i++) {
    if (t <= KEYS[i + 1][0]) {
      const [x0, y0] = KEYS[i]
      const [x1, y1] = KEYS[i + 1]
      return y0 + ((y1 - y0) * (t - x0)) / (x1 - x0)
    }
  }
  return 0
}

const STRAND_COUNT = 6
const paths = Array.from({ length: STRAND_COUNT }, (_, i) => {
  const k = i - (STRAND_COUNT - 1) / 2
  const phase = -TIME * 0.035 + k * 0.012 + Math.sin(TIME * 0.4 + i) * 0.004
  const amp = 92 + Math.sin(TIME * 0.5 + i * 1.3) * 10
  const base = 132 + k * 7 + Math.sin(TIME * 0.6 + i) * 3
  let d = ''
  for (let x = 0; x <= WIDTH; x += 2) d += `${d ? 'L' : 'M'}${x} ${(base - beat((x / WIDTH) * BEATS + phase) * amp).toFixed(1)}`
  return d
})

const STRAND_CLASSES = [styles.strandMint, styles.strandTeal, styles.strandSky, styles.strandBlue, styles.strandViolet, styles.strandLilac]

export function PulseGraphic() {
  return (
    <svg className={styles.wave} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
      {paths.map((d, i) => (
        <path key={i} d={d} className={STRAND_CLASSES[i]} fill="none" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" opacity="0.8" />
      ))}
    </svg>
  )
}
