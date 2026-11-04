import { Button } from '@carbon/react'
import styles from './FilterCards.module.scss'

export type FilterCardItem = { key: string; label: string; count: number }

// The row of large count cards above a list: picking one filters the list to it. A card with nothing behind it keeps its border but
// cannot be picked (and has no hover), unless it is the one already chosen. Used on Platform Insights > Themes and on Measure.
export function FilterCards({ items, selected, onSelect, ariaLabel }: { items: FilterCardItem[]; selected: string; onSelect: (key: string) => void; ariaLabel: string }) {
  return (
    <section className={styles.cards} aria-label={ariaLabel}>
      {items.map((f) => (
        <Button key={f.key} kind="ghost" size="md" className={styles.card} data-kind={f.key} aria-pressed={selected === f.key} disabled={f.count === 0 && selected !== f.key} onClick={() => onSelect(f.key)}>
          <span className={styles.num}>{f.count}</span>
          <span>{f.label}</span>
        </Button>
      ))}
    </section>
  )
}
