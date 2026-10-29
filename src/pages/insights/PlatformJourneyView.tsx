import { Button, InlineNotification, Loading } from '@carbon/react'
import type { PlatformJourney } from '../../api/client'
import { CATEGORY_LABEL } from '../themes/themeEdits'
import { sentimentTop } from '../themes/journeyMap'
import { InsightsHeader } from './InsightsHeader'
import { STATUS } from './labels'
import map from '../themes/JourneyView.module.scss'
import styles from './PlatformJourneyView.module.scss'

export type PlatformJourneyViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  journey?: PlatformJourney
  errorText?: string
  onOpenTheme: (id: string) => void
}

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// A pain point's weight on the dot: what nobody has addressed shows heavier than what is on its way.
const weight = (opportunity: boolean, status: string) => (opportunity ? 'high' : status === 'not_addressed' ? 'medium' : 'low')

// Presentational: the same map as a project's Journey Map (a dark row of stages, then themes, pain points, sentiment and opportunity), folded
// from every analysed project. It is read-only; a theme opens on the Themes screen. A good place to start for anyone new to the team.
export function PlatformJourneyView({ state, journey, errorText, onOpenTheme }: PlatformJourneyViewProps) {
  const stages = journey?.stages ?? []
  // One sentiment point per stage that has a feeling, placed at the middle of its column.
  const points = stages.flatMap((s, i) => (s.sentiment === null ? [] : [{ index: i, sentiment: s.sentiment, left: ((i + 0.5) / stages.length) * 100, top: sentimentTop(s.sentiment) }]))
  const sentimentLabel = points.length ? 'Sentiment by stage: ' + points.map((p) => `${stages[p.index].name} ${p.sentiment < 0 ? 'negative' : 'positive'}`).join(', ') : 'No sentiment to show'
  return (
    <div className={cx(map.page, styles.page)}>
      <InsightsHeader title="Platform Insights" description="The customer’s journey, stage by stage, from every study. A good place to start if you are new to the team" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading the journey" />}
      {state === 'empty' && <p className={styles.muted}>No journey yet. Analyze a project’s transcripts and its journey map is folded in here.</p>}
      {state === 'ready' && journey && (
        <>
          <p className={styles.muted}>
            Folded together from {plural(journey.projectCount, 'project')}. A theme sits in the stage most studies placed it in.
          </p>
          <div className={map.scroll}>
            <div className={map.map} data-columns={stages.length}>
              <div className={map.row}>
                <div className={map.corner} />
                {stages.map((s, i) => (
                  <div key={s.name} className={map.stageHead} data-testid={`journey-stage-${i}`}>
                    <span className={map.stageNumber}>Stage {i + 1}</span>
                    <span className={map.stageName}>{s.name}</span>
                  </div>
                ))}
              </div>

              <div className={map.row}>
                <div className={map.rowLabel}>Themes</div>
                {stages.map((s) => (
                  <section key={s.name} className={cx(map.cell, map.themesCell)} aria-label={`${s.name}: ${s.themes.length} themes`}>
                    {s.themes.map((t) => (
                      <article key={t.id} className={map.card} data-category={t.category} title={CATEGORY_LABEL[t.category]}>
                        <div className={map.cardTop}>
                          <Button kind="ghost" size="sm" className={styles.themeLink} onClick={() => onOpenTheme(t.id)}>
                            {t.title}
                          </Button>
                        </div>
                        <p className={map.meta}>
                          {STATUS[t.status].label} · {t.participantCount}/{journey.totalParticipants}
                        </p>
                      </article>
                    ))}
                  </section>
                ))}
              </div>

              <div className={cx(map.row, map.painRow)}>
                <div className={map.rowLabel}>Pain points</div>
                {stages.map((s) => {
                  const pains = s.themes.filter((t) => t.category === 'pain_point')
                  return (
                    <div key={s.name} className={map.cell}>
                      {pains.length === 0 && <p className={map.none}>None reported</p>}
                      {pains.map((t) => (
                        <div key={t.id} className={map.pain}>
                          <span className={map.dot} data-priority={weight(t.opportunity, t.status)} aria-hidden />
                          <div>
                            <p className={map.painTitle}>{t.title}</p>
                            <p className={map.meta}>
                              {t.participantCount} of {journey.totalParticipants} participants · {plural(t.projectCount, 'project')} · {STATUS[t.status].label}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>

              <div className={cx(map.row, map.sentimentRow)}>
                <div className={map.rowLabel}>Sentiment</div>
                <div className={map.sentiment} role="img" aria-label={sentimentLabel}>
                  <span className={map.axisTop}>Positive</span>
                  <span className={map.axisBottom}>Negative</span>
                  <span className={map.zero} />
                  {points.length > 1 && (
                    <svg className={map.line} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                      <polyline points={points.map((p) => `${p.left},${p.top}`).join(' ')} />
                    </svg>
                  )}
                  {stages.map((s, i) => {
                    const p = points.find((x) => x.index === i)
                    return (
                      <div key={s.name} className={map.track}>
                        {p && <span className={cx(map.point, map[`y${Math.round(p.top)}`])} data-tone={p.sentiment < 0 ? 'negative' : 'positive'} />}
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className={map.row}>
                <div className={map.rowLabel}>Opportunity</div>
                {stages.map((s) => {
                  const open = s.themes.filter((t) => t.opportunity)
                  const text = open.length ? `Address: ${open.map((t) => t.title).join('; ')}` : s.themes.length ? 'No open opportunities here.' : 'No themes mapped to this stage.'
                  return (
                    <div key={s.name} className={map.cell}>
                      <p className={open.length ? map.opportunity : map.none}>{text}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
