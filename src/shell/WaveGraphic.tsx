import styles from './PageHero.module.scss'

// The decorative signal graphic at the right of a title region: 75 rounded bars whose heights follow a fixed, gently varying wave, coloured mint to lilac across the row.
// It is a picture only (hidden from assistive tech, never takes clicks). It does not move.
// The original scale: the picture is 640 wide and 160 high and fills its area (so on a wide screen it is drawn about 1.4 times larger). A bar is 4 wide with 4.5 between (it was 6), so there are 75 of them across the same width.
// The tallest bar is capped at 125 of 160, which keeps it just inside the header where it used to run off the top and bottom.
const BARS = 75
const PITCH = 8.5
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

// The wave formula peaks near 200, so the heights are scaled until the tallest bar is exactly PEAK.
const raw = Array.from({ length: BARS }, (_, i) => barHeight(i, PHASE))
const PEAK = 125
const heights = raw.map((h) => Math.max(6, (h * PEAK) / Math.max(...raw)))

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
        <rect key={i} x={i * PITCH + (PITCH - 4) / 2} y={(HEIGHT - h) / 2} width="4" height={h} rx="2" fill="url(#wave-fill)" />
      ))}
    </svg>
  )
}
