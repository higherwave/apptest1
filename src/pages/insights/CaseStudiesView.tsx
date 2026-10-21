import { Button, InlineNotification, Loading, Tile } from '@carbon/react'
import type { CaseStudy } from '../../api/client'
import { InsightsHeader } from './InsightsHeader'
import styles from './CaseStudiesView.module.scss'

export type CaseStudiesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  cases: CaseStudy[]
  errorText?: string
  onOpenTheme: (id: string) => void
}

// "Sep 2026" from a YYYY-MM-DD date; the day is not meaningful.
const monthYear = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '')

// Presentational: what the team shipped from research, each tied back to the platform themes it came from.
export function CaseStudiesView({ state, cases, errorText, onOpenTheme }: CaseStudiesViewProps) {
  return (
    <div className={styles.page}>
      <InsightsHeader title="Case Studies" description="What the team changed because of what it learned" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading withOverlay={false} description="Loading case studies" />}
      {state === 'empty' && <p className={styles.empty}>No case studies yet.</p>}
      {state === 'ready' && (
        <div className={styles.grid}>
          {cases.map((c) => (
            <Tile key={c.id} className={styles.card} data-tint={c.color} data-testid="case-study">
              <div className={styles.top}>
                <span>{c.ownerTeam}</span>
                <span>{monthYear(c.date)}</span>
              </div>
              <h2 className={styles.title}>{c.title}</h2>
              <p className={styles.summary}>{c.summary}</p>
              <p className={styles.outcome}>{c.outcome}</p>
              <div className={styles.based}>
                <p className={styles.label}>Based on</p>
                <div className={styles.themes}>
                  {c.themes.map((t) => (
                    <Button key={t.id} kind="tertiary" size="sm" onClick={() => onOpenTheme(t.id)}>
                      {t.title}
                    </Button>
                  ))}
                </div>
              </div>
            </Tile>
          ))}
        </div>
      )}
    </div>
  )
}
