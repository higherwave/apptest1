import { Button, ClickableTile, InlineNotification, Loading, ProgressBar, Tag, Tile } from '@carbon/react'
import type { InsightsThemes, PlatformThemeDetail } from '../../api/client'
import { CategoryBadge } from '../themes/CategoryBadge'
import { InsightsHeader } from './InsightsHeader'
import styles from './InsightThemesView.module.scss'

export type InsightThemesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  overview?: InsightsThemes
  selectedId: string | null
  detail?: PlatformThemeDetail
  detailFailed: boolean
  errorText?: string
  onSelect: (id: string) => void
  onOpenTranscripts: (projectId: string) => void
}

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Presentational: recommendations, then the themes seen across projects, and where the selected theme comes from.
export function InsightThemesView({ state, overview, selectedId, detail, detailFailed, errorText, onSelect, onOpenTranscripts }: InsightThemesViewProps) {
  const projectOf = (id: string) => overview?.projects.find((p) => p.id === id)
  return (
    <div className={styles.page}>
      <InsightsHeader title="Platform Insights" description="What the team has learned across research projects" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading withOverlay={false} description="Loading insights" />}
      {state === 'empty' && <p className={styles.empty}>No themes yet. Analyze a project’s transcripts and its themes appear here.</p>}
      {state === 'ready' && overview && (
        <>
          <section className={styles.section} aria-labelledby="recs-heading">
            <h2 id="recs-heading" className={styles.label}>Recommendations</h2>
            <div className={styles.recs}>
              {overview.recommendations.map((r, i) => (
                <Tile key={r.id} className={styles.rec} data-tint={['sky', 'lavender', 'mint', 'sand'][i % 4]}>
                  <p className={styles.recTitle}>{r.title}</p>
                  <p className={styles.recMeta}>
                    {plural(r.themes.length, 'theme')} · {plural(r.projectCount, 'project')}
                  </p>
                  <Tag size="sm" type={r.priority === 'high' ? 'red' : 'gray'}>{r.priority === 'high' ? 'High priority' : r.priority === 'medium' ? 'Medium priority' : 'Low priority'}</Tag>
                </Tile>
              ))}
            </div>
          </section>

          <div className={styles.split}>
            <section className={styles.section} aria-labelledby="themes-heading">
              <h2 id="themes-heading" className={styles.label}>Themes across projects</h2>
              <div className={styles.list}>
                {overview.themes.map((t) => (
                  <ClickableTile key={t.id} className={styles.row} data-selected={t.id === selectedId} data-testid={`platform-theme-${t.id}`} onClick={() => onSelect(t.id)}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{t.title}</p>
                      <div className={styles.chips}>
                        <CategoryBadge category={t.category} />
                        {t.sources.map((s) => (
                          <span key={s.projectId} className={styles.chip} data-tint={projectOf(s.projectId)?.color}>
                            {projectOf(s.projectId)?.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className={styles.rowCount}>
                      <p className={styles.count}>
                        {t.participantCount} of {overview.totalParticipants} participants
                      </p>
                      <ProgressBar label={`${t.title}: participants`} hideLabel size="small" value={t.participantCount} max={Math.max(overview.totalParticipants, 1)} />
                    </div>
                  </ClickableTile>
                ))}
              </div>
            </section>

            <aside className={styles.panel} aria-label="Where this comes from">
              <h2 className={styles.label}>Where this comes from</h2>
              {detailFailed && <p className={styles.empty}>This theme could not be loaded.</p>}
              {!detail && !detailFailed && <Loading withOverlay={false} small description="Loading" />}
              {detail && detail.id === selectedId && (
                <>
                  <p className={styles.panelTitle}>{detail.title}</p>
                  <p className={styles.panelText}>
                    Raised by {detail.participantCount} of {detail.totalParticipants} participants across {detail.projectCount} of {plural(detail.totalProjects, 'project')}.
                  </p>
                  {detail.sources.map((s) => (
                    <div key={s.projectId} className={styles.source}>
                      <div className={styles.sourceHead}>
                        <span className={styles.chip} data-tint={s.color}>{s.projectName}</span>
                        <span className={styles.panelText}>
                          {s.participantCount} of {s.projectParticipants} participants
                        </span>
                        {s.matchMethod === 'manual' && <Tag size="sm" type="gray">Tagged by hand</Tag>}
                      </div>
                      {s.quotes.map((q) => (
                        <blockquote key={q.id} className={styles.quote}>
                          <p className={styles.quoteText}>“{q.text}”</p>
                          <p className={styles.quoteMeta}>
                            {q.speaker} · {q.session}
                            {q.timestamp ? ` · ${q.timestamp}` : ''}
                          </p>
                        </blockquote>
                      ))}
                      <Button kind="ghost" size="sm" onClick={() => onOpenTranscripts(s.projectId)}>
                        Open transcripts for {s.projectName}
                      </Button>
                    </div>
                  ))}
                </>
              )}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
