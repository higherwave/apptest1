import type { ReactNode } from 'react'
import styles from './PageHero.module.scss'

// The title area at the top of a main screen: white, reaching to the edges of the content area, with a soft glow behind it.
// Whatever is passed as children (a button, a switcher) sits at its right.
export function PageHero({ title, description, glow = 'right', children }: { title: string; description: string; glow?: 'left' | 'right'; children?: ReactNode }) {
  return (
    <header className={styles.hero} data-glow={glow}>
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
