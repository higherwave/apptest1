import type { ThemeCategory } from '../../api/client'
import { CATEGORY_LABEL } from './themeEdits'
import styles from './CategoryBadge.module.scss'

// A theme's category as a small tinted label: Pain point, Need, Expectation or Delight. `quiet` turns every category but Pain point light gray, so on a
// crowded table the pain points are the ones that stand out.
export function CategoryBadge({ category, quiet = false }: { category: ThemeCategory; quiet?: boolean }) {
  return (
    <span className={styles.badge} data-category={category} data-quiet={quiet}>
      {CATEGORY_LABEL[category]}
    </span>
  )
}
