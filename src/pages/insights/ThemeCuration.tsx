import { Button, InlineNotification, Tag } from '@carbon/react'
import type { InsightsThemes } from '../../api/client'
import styles from './ThemeCuration.module.scss'

type Row = InsightsThemes['themes'][number]

const pct = (n: number | null) => (n === null ? '' : ` · ${Math.round(n * 100)}%`)

/** What the page can do beyond reading the themes (have the priority reasons written); passed down as one object so the view stays presentational. */
export type Curation = {
  canEdit: boolean
  busy: boolean
  error?: string
  onRationale: () => void
}

// The suggested rank, its figures, and the written reason; editors can have the reasons written.
export function PriorityNote({ theme, curation }: { theme: Row; curation: Curation }) {
  if (!theme.priority) return null
  return (
    <section aria-label="Suggested priority" data-testid={`priority-${theme.id}`}>
      <h3 className={styles.label}>Suggested priority</h3>
      <div className={styles.text}>
        <Tag size="sm" type="purple">
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

// How each project theme came to be filed here, with the model's reason when it made the match.
// One line for each different match. The same project theme matched the same way in several projects (the same analysis run on
// each) is one line with how many projects, not the same line again.
export function MatchList({ theme }: { theme: Row }) {
  if (!theme.matches.length) return null
  const lines = new Map<string, { match: Row['matches'][number]; projects: number }>()
  for (const m of theme.matches) {
    const key = [m.themeTitle, m.method, m.confidence, m.reason].join('|')
    const line = lines.get(key)
    if (line) line.projects++
    else lines.set(key, { match: m, projects: 1 })
  }
  return (
    <section aria-label="How themes were matched">
      <h3 className={styles.label}>How themes were matched</h3>
      <ul className={styles.matches}>
        {[...lines.values()].map(({ match: m, projects }, i) => (
          <li key={i} className={styles.text}>
            <strong>{m.themeTitle}</strong>
            <br />
            <span className={styles.muted}>
              {m.method === 'manual' ? 'Set by hand' : `AI match${pct(m.confidence)}`}
              {m.reason ? `: ${m.reason}` : ''}
              {projects > 1 ? ` · in ${projects} projects` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
