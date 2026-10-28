import { Button, ClickableTile, InlineNotification, Loading, ProgressBar, Tag, Tile } from '@carbon/react'
import { useState } from 'react'
import type { InsightsThemes, PlatformThemeDetail } from '../../api/client'
import { CategoryBadge } from '../themes/CategoryBadge'
import { InsightsHeader } from './InsightsHeader'
import { STATUS } from './labels'
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
  /** Opens a step of one of the projects, such as its Measure page. */
  onOpenStep: (projectId: string, step: 'measure' | 'stories') => void
}

type Row = InsightsThemes['themes'][number]
type Filter = 'recurring' | 'opportunities' | 'needs_attention' | 'worked'

const TREND = { new: 'New', growing: '↑ Growing', steady: '→ Steady', fading: '↓ Fading' } as const
const RESULT_LABEL = { worked: 'Worked', needs_attention: 'Needs attention', too_early: 'Too early to tell' } as const
const FILTERS: { key: Filter; label: string; count: (o: InsightsThemes) => number; keep: (t: Row) => boolean }[] = [
  { key: 'recurring', label: 'Recurring pain points', count: (o) => o.summary.recurring, keep: (t) => t.projectCount >= 2 && t.category !== 'delight' },
  { key: 'opportunities', label: 'Opportunities', count: (o) => o.summary.opportunities, keep: (t) => t.opportunity },
  { key: 'needs_attention', label: 'Needs attention', count: (o) => o.summary.needsAttention, keep: (t) => t.status === 'needs_attention' },
  { key: 'worked', label: 'Worked', count: (o) => o.summary.worked, keep: (t) => t.status === 'worked' },
]

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Presentational: recommendations, then the themes seen across projects, and where the selected theme comes from.
export function InsightThemesView({ state, overview, selectedId, detail, detailFailed, errorText, onSelect, onOpenTranscripts, onOpenStep }: InsightThemesViewProps) {
  const [filter, setFilter] = useState<Filter | null>(null)
  const shown = overview ? (filter ? overview.themes.filter(FILTERS.find((f) => f.key === filter)!.keep) : overview.themes) : []
  const projectOf = (id: string) => overview?.projects.find((p) => p.id === id)
  return (
    <div className={styles.page}>
      <InsightsHeader title="Platform Insights" description="What the team has learned across research projects" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading withOverlay={false} description="Loading insights" />}
      {state === 'empty' && <p className={styles.empty}>No themes yet. Analyze a project’s transcripts and its themes appear here.</p>}
      {state === 'ready' && overview && (
        <>
          <section className={styles.cards} aria-label="What the themes add up to">
            {FILTERS.map((f) => {
              const n = f.count(overview)
              return (
                <Button key={f.key} kind="ghost" size="md" className={styles.card} data-kind={f.key} aria-pressed={filter === f.key} disabled={n === 0 && filter !== f.key} onClick={() => setFilter(filter === f.key ? null : f.key)}>
                  <span className={styles.cardNum}>{n}</span>
                  <span>{f.label}</span>
                </Button>
              )
            })}
          </section>

          <section className={styles.section} aria-labelledby="recs-heading">
            <h2 id="recs-heading" className={styles.label}>Recommendations</h2>
            <div className={styles.recs}>
              {overview.recommendations.map((r, i) => (
                <Tile key={r.id} className={styles.rec} data-tint={['sky', 'lavender', 'mint', 'sand'][i % 4]}>
                  <p className={styles.recTitle}>{r.title}</p>
                  <p className={styles.recMeta}>
                    {plural(r.themes.length, 'theme')} · {plural(r.projectCount, 'project')}
                  </p>
                </Tile>
              ))}
            </div>
          </section>

          <div className={styles.split}>
            <section className={styles.section} aria-labelledby="themes-heading">
              <h2 id="themes-heading" className={styles.label}>Themes across projects</h2>
              <div className={styles.list}>
                {shown.map((t) => (
                  <ClickableTile key={t.id} className={styles.row} data-selected={t.id === selectedId} data-testid={`platform-theme-${t.id}`} onClick={() => onSelect(t.id)}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{t.title}</p>
                      <div className={styles.chips}>
                        <CategoryBadge category={t.category} />
                        {t.opportunity && <Tag size="sm" type="purple">Opportunity</Tag>}
                        <Tag size="sm" type={STATUS[t.status].tag}>{STATUS[t.status].label}</Tag>
                        {t.trend && <Tag size="sm" type="gray">{TREND[t.trend]}</Tag>}
                        {t.sources.map((s) => (
                          <span key={s.projectId} className={styles.chip}>
                            {projectOf(s.projectId)?.name}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className={styles.rowCount}>
                      <p className={styles.count}>
                        {t.participantCount} of {overview.totalParticipants} participants
                      </p>
                      <p className={styles.countSub}>{plural(t.projectCount, 'project')}</p>
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
                  <WhatHappened row={overview.themes.find((t) => t.id === detail.id)} projects={overview.projects} onOpenStep={onOpenStep} />
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
                            <Button kind="ghost" size="sm" className={styles.open} onClick={() => onOpenTranscripts(s.projectId)}>
                              Open transcript
                            </Button>
                          </p>
                        </blockquote>
                      ))}
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

// Under a theme: what became of it. A requirement for each project that wrote one, with its newest finding, or a note that it is an opportunity.
function WhatHappened({ row, projects, onOpenStep }: { row?: Row; projects: InsightsThemes['projects']; onOpenStep: InsightThemesViewProps['onOpenStep'] }) {
  if (!row) return null
  return (
    <div className={styles.happened} data-testid="what-happened">
      <h3 className={styles.label}>What happened</h3>
      {row.requirements.length === 0 ? (
        <p className={styles.panelText}>
          {row.opportunity ? `An opportunity: raised in ${plural(row.projectCount, 'project')} and no requirement addresses it yet.` : 'No requirement has been written for this yet.'}
        </p>
      ) : (
        row.requirements.map((r) => (
          <div key={`${r.projectId}-${r.key}`} className={styles.req}>
            <p className={styles.panelText}>
              <strong>{r.key}</strong> {r.title} <span className={styles.muted}>· {projects.find((p) => p.id === r.projectId)?.name}</span>
            </p>
            <div className={styles.reqTags}>
              <Tag size="sm" type={r.result ? STATUS[r.result].tag : 'blue'}>{r.result ? RESULT_LABEL[r.result] : 'Not measured yet'}</Tag>
              <Button kind="ghost" size="sm" className={styles.open} onClick={() => onOpenStep(r.projectId, 'measure')}>
                Open Measure
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  )
}
