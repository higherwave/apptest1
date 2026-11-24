import styles from './PageHero.module.scss'

// The decorative signal graphic at the right of a title region: 64 rounded bars whose heights follow a fixed, gently varying wave, coloured mint to lilac across the row.
// It is a picture only (hidden from assistive tech, never takes clicks). It does not move.
const BARS = 64
const PITCH = 10
const WIDTH = BARS * PITCH
const HEIGHT = 160
const PHASE = 1.5

// The height of bar i at time s (seconds); the picture is still, drawn at one fixed time.
const barHeight = (i: number, s: number) => {
  const x = i / BARS
  const envelope = Math.sin(Math.PI * x) * 0.6 + 0.4
  const wave = Math.sin(x * 9 - s * 0.9) * 0.5 + Math.sin(x * 23 + s * 0.6) * 0.25 + 0.75
  return Math.max(6, envelope * wave * 150)
}

const heights = Array.from({ length: BARS }, (_, i) => barHeight(i, PHASE))

export function WaveGraphic() {
  return (
    <svg className={styles.wave} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="wave-fill" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={WIDTH} y2="0">
          <stop offset="0%" className={styles.stopMint} />
          <stop offset="25%" className={styles.stopSky} />
          <stop offset="50%" className={styles.stopBlue} />
          <stop offset="75%" className={styles.stopViolet} />
          <stop offset="100%" className={styles.stopLilac} />
        </linearGradient>
      </defs>
      {heights.map((h, i) => (
        <rect key={i} x={i * PITCH + 3} y={(HEIGHT - h) / 2} width="4" height={h} rx="2" fill="url(#wave-fill)" />
      ))}
    </svg>
  )
}
