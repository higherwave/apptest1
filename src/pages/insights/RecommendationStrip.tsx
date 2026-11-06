import { ChevronLeft, ChevronRight } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import type { InsightsThemes } from '../../api/client'
import { useStrip } from '../../components/useStrip'
import styles from './RecommendationStrip.module.scss'

type Rec = InsightsThemes['recommendations'][number]

const PRIORITY = { high: 'High priority', medium: 'Medium priority', low: 'Low priority' } as const
const RANK = { high: 0, medium: 1, low: 2 } as const
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Most important first, and alphabetical within each priority.
export const sortRecommendations = (recs: Rec[]) => [...recs].sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.title.localeCompare(b.title))

// The recommendations as one row of cards that scrolls sideways (Previous and Next move it, and the next card peeks in at the edge).
// Picking a card selects it, so the table below can show only the themes it covers.
export function RecommendationStrip({ recs, selectedId, onSelect }: { recs: Rec[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const sorted = sortRecommendations(recs)
  const { track, view, measure, move } = useStrip(sorted.length, recs)

  const all = view.first === 1 && view.last === sorted.length
  return (
    <section className={styles.strip} aria-labelledby="recs-heading">
      <div className={styles.head}>
        <h2 id="recs-heading" className={styles.label}>Recommendations</h2>
        <div className={styles.controls}>
          <span className={styles.count} role="status">
            {all ? `All ${sorted.length}` : `Showing ${view.first}–${view.last} of ${sorted.length}`}
          </span>
          {!all && (
            <>
              <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronLeft} iconDescription="Previous recommendations" tooltipPosition="bottom" disabled={!view.canBack} onClick={() => move(-1)} />
              <Button kind="ghost" size="sm" hasIconOnly renderIcon={ChevronRight} iconDescription="Next recommendations" tooltipPosition="bottom" disabled={!view.canForward} onClick={() => move(1)} />
            </>
          )}
        </div>
      </div>
      <ul ref={track} className={styles.track} onScroll={measure} aria-label="Recommendations, most important first">
        {sorted.map((r, i) => (
          <li key={r.id} className={styles.item}>
            <Button kind="ghost" size="md" className={styles.rec} data-testid={`rec-${r.id}`} aria-pressed={selectedId === r.id} onClick={() => onSelect(selectedId === r.id ? null : r.id)}>
              <span className={styles.recHead}>
                <span className={styles.label}>Recommendation {String(i + 1).padStart(2, '0')}</span>
                <span className={styles.dot} data-priority={r.priority} role="img" aria-label={PRIORITY[r.priority]} title={PRIORITY[r.priority]} />
              </span>
              <span className={styles.recTitle}>{r.title}</span>
              <span className={styles.recMeta}>
                {plural(r.themes.length, 'theme')} · {plural(r.projectCount, 'project')}
              </span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  )
}
