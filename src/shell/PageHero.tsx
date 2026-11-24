import type { ReactNode } from 'react'
import styles from './PageHero.module.scss'
import { PulseGraphic } from './PulseGraphic'
import { WaveGraphic } from './WaveGraphic'

// The title area at the top of a main screen, reaching to the edges of the content area. Whatever is passed as children (a button, a switcher) sits at its right.
// variant "wave" is the newer look (Platform Insights, Projects, Measure): a white region with a hairline below and a row of signal bars behind its right side. `graphic` picks the picture: the signal bars (default) or Pulse's heartbeat line. `flush` is for a title region that sits outside the page's padded area (under the app header, as on Settings): it carries its own side padding and does not reach back out through the page's. The default is the slate blue wash.
export function PageHero({ title, description, glow = 'right', variant, graphic = 'wave', flush = false, children }: { title: string; description: string; glow?: 'left' | 'right'; variant?: 'wave'; graphic?: 'wave' | 'pulse'; flush?: boolean; children?: ReactNode }) {
  return (
    <header className={styles.hero} data-glow={glow} data-variant={variant} data-flush={flush}>
      {variant === 'wave' && (
        <div className={styles.art} data-graphic={graphic} aria-hidden="true">
          {graphic === 'pulse' ? <PulseGraphic /> : <WaveGraphic />}
        </div>
      )}
      <div className={styles.inner}>
        <div>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.description}>{description}</p>
        </div>
        {children}
      </div>
    </header>
  )
}
