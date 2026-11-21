import type { HTMLAttributes, ReactNode } from 'react'
import styles from './TitleBar.module.scss'

// The slim title bar under the app header for a project and for Admin: what you are in, with the soft ribbons (a decorative graphic, hidden from assistive tech) at its right. The
// ribbons never take clicks and fade out toward the left, so a long project name stays readable.
export function TitleBar({ children, ...rest }: { children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={styles.bar} {...rest}>
      <div className={styles.ribbons} aria-hidden="true">
        <span className={styles.ribbon} />
        <span className={styles.ribbon} />
        <span className={styles.ribbon} />
        <span className={styles.ribbon} />
      </div>
      <div className={styles.inner}>{children}</div>
    </div>
  )
}
