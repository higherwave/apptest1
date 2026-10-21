import type { ThemeCategory } from '../../api/client'
import { CATEGORY_LABEL } from './themeEdits'
import styles from './CategoryBadge.module.scss'

// A theme's category as a small tinted label: Pain point, Need, Expectation or Delight.
export function CategoryBadge({ category }: { category: ThemeCategory }) {
  return (
    <span className={styles.badge} data-category={category}>
      {CATEGORY_LABEL[category]}
    </span>
  )
}
