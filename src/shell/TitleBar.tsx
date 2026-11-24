import type { HTMLAttributes, ReactNode } from 'react'
import { WaveGraphic } from './WaveGraphic'
import styles from './TitleBar.module.scss'

// The slim title bar under the app header for a project and for Settings: what you are in, with the signal bars (a decorative graphic, hidden from assistive tech) at its right. The
// bars never take clicks and fade out toward the left, so a long project name stays readable.
export function TitleBar({ children, ...rest }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={styles.bar} {...rest}>
      <div className={styles.ribbons} aria-hidden="true">
        <WaveGraphic />
      </div>
      <div className={styles.inner}>{children}</div>
    </div>
  )
}
