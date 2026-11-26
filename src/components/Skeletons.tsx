import { SkeletonPlaceholder, SkeletonText } from '@carbon/react'
import type { ReactNode } from 'react'
import styles from './Skeletons.module.scss'

// Loading placeholders: the shapes of the page that is coming, in grey, so people know at once that it is on its way. They are announced once ("Loading the topic") and are hidden from assistive technology
// piece by piece; for people who ask for less motion the shimmer stops (theme.scss).

/** Wraps a page's placeholders. `label` is what is read out. */
export function SkeletonRegion({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.region} role="status" aria-live="polite" aria-busy="true" data-testid="skeleton">
      <span className={styles.sr}>{label}</span>
      <div className={styles.region} aria-hidden="true">
        {children}
      </div>
    </div>
  )
}

/** A card with a heading line and some lines of text. */
export function SkeletonCard({ lines = 3, headingWidth = '30%' }: { lines?: number; headingWidth?: string }) {
  return (
    <div className={styles.card}>
      <SkeletonText heading width={headingWidth} />
      <SkeletonText paragraph lineCount={lines} />
    </div>
  )
}

/** A few quotes: two lines of words and a short line under each. */
export function SkeletonQuotes({ count = 3 }: { count?: number }) {
  return (
    <div className={styles.card}>
      <SkeletonText heading width="22%" />
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={styles.quote}>
          <SkeletonText paragraph lineCount={2} />
          <SkeletonText width="45%" />
        </div>
      ))}
    </div>
  )
}

/** A list page: optional cards across the top, a toolbar, and rows with a title and two short columns. */
export function SkeletonList({ cards = 0, toolbar = false, rows = 6 }: { cards?: number; toolbar?: boolean; rows?: number }) {
  return (
    <>
      {cards > 0 && (
        <div className={styles.cards}>
          {Array.from({ length: cards }, (_, i) => (
            <SkeletonCard key={i} lines={3} />
          ))}
        </div>
      )}
      {toolbar && (
        <div className={styles.toolbar}>
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonPlaceholder key={i} className={styles.block} />
          ))}
        </div>
      )}
      <div className={styles.table}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={styles.row}>
            <div>
              <SkeletonText heading width={`${52 + ((i * 11) % 30)}%`} />
              <SkeletonText width={`${70 - ((i * 7) % 25)}%`} />
            </div>
            <SkeletonText width="70%" />
            <SkeletonText width="50%" />
          </div>
        ))}
      </div>
    </>
  )
}
