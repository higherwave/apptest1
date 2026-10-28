import { Button, InlineNotification, Loading, Tag } from '@carbon/react'
import type { PlatformJourney } from '../../api/client'
import { CategoryBadge } from '../themes/CategoryBadge'
import { InsightsHeader } from './InsightsHeader'
import { STATUS } from './labels'
import styles from './PlatformJourneyView.module.scss'

export type PlatformJourneyViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  journey?: PlatformJourney
  errorText?: string
  onOpenTheme: (id: string) => void
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// How a stage feels, from the mean severity of its themes.
const feeling = (s: number | null) =>
  s === null ? { label: 'No data', tag: 'outline' as const } : s <= -0.5 ? { label: 'Very negative', tag: 'red' as const } : s <= -0.15 ? { label: 'Negative', tag: 'red' as const } : s < 0.15 ? { label: 'Neutral', tag: 'gray' as const } : s < 0.5 ? { label: 'Positive', tag: 'green' as const } : { label: 'Very positive', tag: 'green' as const }

// Presentational: the whole customer journey in one picture, each stage with how it feels, the themes that sit in it and the opportunities.
// It is the place to start for anyone new to the team.
export function PlatformJourneyView({ state, journey, errorText, onOpenTheme }: PlatformJourneyViewProps) {
  return (
    <div className={styles.page}>
      <InsightsHeader title="Platform Insights" description="The customer’s journey, stage by stage, from every study. A good place to start if you are new to the team" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading withOverlay={false} description="Loading the journey" />}
      {state === 'empty' && <p className={styles.muted}>No journey yet. Analyze a project’s transcripts and its journey map is folded in here.</p>}
      {state === 'ready' && journey && (
        <>
          <p className={styles.muted}>
            Folded together from {plural(journey.projectCount, 'project')}. A theme sits in the stage most studies placed it in.
          </p>
          <div className={styles.scroll}>
            <ol className={styles.map} aria-label="Customer journey">
              {journey.stages.map((s, i) => {
                const f = feeling(s.sentiment)
                return (
                  <li key={s.name} className={styles.stage} data-testid={`journey-stage-${i}`}>
                    <div className={styles.head}>
                      <span className={styles.number}>Stage {i + 1}</span>
                      <span className={styles.name}>{s.name}</span>
                    </div>
                    <div className={styles.feel}>
                      <span className={styles.rowLabel}>How it feels</span>
                      <Tag size="sm" type={f.tag}>{f.label}</Tag>
                    </div>
                    <div className={styles.themes}>
                      <span className={styles.rowLabel}>Themes</span>
                      {s.themes.length === 0 && <p className={styles.muted}>None raised here.</p>}
                      {s.themes.map((t) => (
                        <div key={t.id} className={styles.theme}>
                          <Button kind="ghost" size="sm" className={styles.themeLink} onClick={() => onOpenTheme(t.id)}>
                            {t.title}
                          </Button>
                          <div className={styles.tags}>
                            <CategoryBadge category={t.category} />
                            {t.opportunity && <Tag size="sm" type="purple">Opportunity</Tag>}
                            <Tag size="sm" type={STATUS[t.status].tag}>{STATUS[t.status].label}</Tag>
                          </div>
                          <span className={styles.count}>{plural(t.participantCount, 'participant')} · {plural(t.projectCount, 'project')}</span>
                        </div>
                      ))}
                    </div>
                    <div className={styles.opps}>
                      <span className={styles.rowLabel}>Opportunities</span>
                      {s.opportunities === 0 ? (
                        <p className={styles.muted}>Nothing left unaddressed.</p>
                      ) : (
                        <p className={styles.oppText}>
                          {plural(s.opportunities, 'theme')} raised again and again with no requirement: {s.themes.filter((t) => t.opportunity).map((t) => t.title).join('; ')}.
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </div>
        </>
      )}
    </div>
  )
}
