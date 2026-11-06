import { Button, InlineNotification, Tag } from '@carbon/react'
import type { InsightsThemes, MergeRecord } from '../../api/client'
import styles from './ThemeCuration.module.scss'

type Row = InsightsThemes['themes'][number]

const pct = (n: number | null) => (n === null ? '' : ` · ${Math.round(n * 100)}%`)

/** What the page can do beyond reading the themes (have the priority reasons written); passed down as one object so the view stays presentational. */
export type Curation = {
  canEdit: boolean
  busy: boolean
  error?: string
  onRationale: () => void
  /** Recent merges, newest first, and taking one back. Without them the panel is not shown. */
  merges?: MergeRecord[]
  onUndo?: (id: string) => void
  /** Files a theme that has no area under one. Themes that already have an area are not changed from the table. */
  onAssignArea?: (themeId: string, areaId: string) => void
  /** Takes back a filing a person made. */
  onClearArea?: (themeId: string) => void
}

// The suggested rank, its figures, and the written reason; editors can have the reasons written.
export function PriorityNote({ theme, curation }: { theme: Row; curation: Curation }) {
  if (!theme.priority) return null
  return (
    <section aria-label="Suggested priority" data-testid={`priority-${theme.id}`}>
      <h3 className={styles.label}>Suggested priority</h3>
      <div className={styles.text}>
        <Tag size="sm" type="gray">
          #{theme.priority.rank}
        </Tag>{' '}
        Score {theme.priority.score}. {theme.rationale ?? 'No rationale written yet.'}
      </div>
      {!theme.rationale && curation.canEdit && theme.priority.rank <= 8 && (
        <Button kind="ghost" size="sm" disabled={curation.busy} onClick={curation.onRationale}>
          Write rationale for the top 8
        </Button>
      )}
    </section>
  )
}

const when = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// Themes folded into others, the ones the system merged on its own marked as such. Undo puts the theme back exactly as it was,
// so a wrong merge costs one click, not a rebuild.
export function RecentMerges({ curation }: { curation: Curation }) {
  const merges = curation.merges ?? []
  if (!merges.length && !curation.canEdit) return null
  return (
    <section className={styles.recent} aria-label="Recent merges" data-testid="recent-merges">
      <h2 className={styles.label}>Recent merges</h2>
      {!merges.length && <p className={styles.text}>None yet. When two themes say the same thing, the clear pairs are merged here on their own, and you can undo any of them.</p>}
      <ul className={styles.matches}>
        {merges.map((m) => (
          <li key={m.id} className={styles.mergeRow} data-testid={`merge-${m.id}`}>
            <span className={styles.text}>
              <strong>{m.mergedTitle}</strong> was folded into <strong>{m.keptTitle}</strong>
              <br />
              <span className={styles.muted}>
                {m.auto ? `Merged automatically${pct(m.confidence)}` : 'Merged by hand'} · {when(m.createdAt)}
                {m.reason ? `: ${m.reason}` : ''}
                {m.undone ? ' · Undone' : ''}
              </span>
            </span>
            {m.canUndo && curation.canEdit && curation.onUndo && (
              <Button kind="tertiary" size="sm" disabled={curation.busy} data-testid={`undo-${m.id}`} onClick={() => curation.onUndo!(m.id)}>
                Undo
              </Button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
