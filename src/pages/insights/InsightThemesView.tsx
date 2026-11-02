import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, ProgressBar, Tag } from '@carbon/react'
import { useState } from 'react'
import type { InsightsThemes } from '../../api/client'
import { CategoryBadge } from '../themes/CategoryBadge'
import { InsightsHeader } from './InsightsHeader'
import { RecommendationStrip } from './RecommendationStrip'
import { DuplicatesPanel, MatchList, PriorityNote, ThemeTools, type Curation } from './ThemeCuration'
import { STATUS } from './labels'
import styles from './InsightThemesView.module.scss'

export type InsightThemesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  overview?: InsightsThemes
  /** The theme whose row is open, if any. */
  openId: string | null
  errorText?: string
  onToggle: (id: string) => void
  /** Owners and editors can clear the "New, review" flag on a theme the model started. */
  canReview?: boolean
  reviewing?: boolean
  onReviewed?: (id: string) => void
  /** Rename, merge, duplicate suggestions and the rank rationale. */
  curation?: Curation
}

type Row = InsightsThemes['themes'][number]
type Filter = 'all' | 'recurring' | 'opportunities' | 'needs_attention' | 'worked'

const TREND = { new: 'New', growing: '↑ Growing', steady: '→ Steady', fading: '↓ Fading' } as const
const FILTERS: { key: Filter; label: string; count: (o: InsightsThemes) => number; keep: (t: Row) => boolean }[] = [
  { key: 'all', label: 'All themes', count: (o) => o.themes.length, keep: () => true },
  { key: 'recurring', label: 'Recurring pain points', count: (o) => o.summary.recurring, keep: (t) => t.projectCount >= 2 && t.category !== 'delight' },
  { key: 'opportunities', label: 'Opportunities', count: (o) => o.summary.opportunities, keep: (t) => t.opportunity },
  { key: 'needs_attention', label: 'Needs attention', count: (o) => o.summary.needsAttention, keep: (t) => t.status === 'needs_attention' },
  { key: 'worked', label: 'Worked', count: (o) => o.summary.worked, keep: (t) => t.status === 'worked' },
]

const NO_CURATION: Curation = { canEdit: false, busy: false, onRename: () => {}, onMerge: () => {}, onFindDuplicates: () => {}, onAccept: () => {}, onDismiss: () => {}, onRationale: () => {} }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Presentational: what the team should do (recommendations), then every theme seen across projects as a row that opens to say where it
// comes from, what it means and what to do about it. Scanning the rows is the point; the evidence lives in each project.
export function InsightThemesView({ state, overview, openId, errorText, onToggle, canReview, reviewing, onReviewed, curation }: InsightThemesViewProps) {
  const [filter, setFilter] = useState<Filter>('all')
  // A recommendation picked on the strip narrows the table to the themes it covers.
  const [recId, setRecId] = useState<string | null>(null)
  const rec = overview?.recommendations.find((r) => r.id === recId) ?? null
  const byCount = overview ? overview.themes.filter(FILTERS.find((f) => f.key === filter)!.keep) : []
  const narrowed = rec ? byCount.filter((t) => rec.themes.some((x) => x.id === t.id)) : byCount
  // Reach is the server's order; Suggested priority follows the rank (delights, which are not ranked, last).
  const [order, setOrder] = useState<'reach' | 'priority'>('reach')
  const shown = order === 'priority' ? [...narrowed].sort((a, b) => (a.priority?.rank ?? 1e9) - (b.priority?.rank ?? 1e9)) : narrowed
  return (
    <div className={styles.page}>
      <InsightsHeader title="Platform Insights" description="What the team has learned across research projects" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading insights" />}
      {state === 'empty' && <p className={styles.empty}>No themes yet. Analyze a project’s transcripts and its themes appear here.</p>}
      {state === 'ready' && overview && (
        <>
          <RecommendationStrip recs={overview.recommendations} selectedId={recId} onSelect={setRecId} />

          <div className={styles.group}>
            <h2 id="themes-heading" className={styles.label}>Themes across projects</h2>

            <section className={styles.cards} aria-label="What the themes add up to">
              {FILTERS.map((f) => {
                const n = f.count(overview)
                return (
                  <Button key={f.key} kind="ghost" size="md" className={styles.card} data-kind={f.key} aria-pressed={filter === f.key} disabled={n === 0 && filter !== f.key} onClick={() => setFilter(f.key)}>
                    <span className={styles.cardNum}>{n}</span>
                    <span>{f.label}</span>
                  </Button>
                )
              })}
            </section>
          </div>

          {curation && <DuplicatesPanel suggestions={overview.mergeSuggestions} curation={curation} />}

          <div className={styles.order} role="group" aria-label="Order the themes">
            <span className={styles.label}>Order</span>
            {([['reach', 'Reach'], ['priority', 'Suggested priority']] as const).map(([key, label]) => (
              <Button key={key} kind={order === key ? 'primary' : 'ghost'} size="sm" aria-pressed={order === key} data-testid={`order-${key}`} onClick={() => setOrder(key)}>
                {label}
              </Button>
            ))}
          </div>

          {rec && (
            <p className={styles.picked} role="status">
              <span>
                Showing {plural(shown.length, 'theme')} for: <strong>{rec.title}</strong>
              </span>
              <Button kind="ghost" size="sm" onClick={() => setRecId(null)}>
                Clear
              </Button>
            </p>
          )}

          <section className={styles.table} aria-labelledby="themes-heading">
            <div className={styles.columns} aria-hidden>
              <span className={styles.label}>Themes</span>
              <span className={styles.label}>Type</span>
              <span className={styles.label}>Status</span>
              <span className={styles.label}>Trend</span>
              <span className={styles.label}>Participants</span>
            </div>
            <ul className={styles.list} aria-label="Themes across projects">
              {shown.map((t) => {
                const open = t.id === openId
                const recs = overview.recommendations.filter((r) => r.themes.some((x) => x.id === t.id))
                return (
                  <li key={t.id} className={styles.item} data-testid={`platform-theme-${t.id}`} data-open={open}>
                    <Button kind="ghost" size="md" className={styles.headButton} renderIcon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={`theme-body-${t.id}`} onClick={() => onToggle(t.id)}>
                      <span className={styles.columns}>
                        <span className={styles.rowTitle}>{t.title}</span>
                        <span className={styles.chips}>
                          <CategoryBadge category={t.category} />
                          {t.needsReview && <Tag size="sm" type="warm-gray">New · review</Tag>}
                          {order === 'priority' && t.priority && <Tag size="sm" type="purple">#{t.priority.rank}</Tag>}
                          {t.opportunity && <Tag size="sm" type="purple">Opportunity</Tag>}
                        </span>
                        <span>
                          <Tag size="sm" type={STATUS[t.status].tag}>{STATUS[t.status].label}</Tag>
                        </span>
                        <span>{t.trend && <Tag size="sm" type="gray">{TREND[t.trend]}</Tag>}</span>
                        <span className={styles.rowCount}>
                          <span className={styles.count}>
                            {t.participantCount} of {overview.totalParticipants} participants <span className={styles.muted}>· {plural(t.projectCount, 'project')}</span>
                          </span>
                          <ProgressBar label={`${t.title}: participants`} hideLabel size="small" value={t.participantCount} max={Math.max(overview.totalParticipants, 1)} />
                        </span>
                      </span>
                    </Button>
                    {open && (
                      <div id={`theme-body-${t.id}`} className={styles.detail}>
                        <section aria-label="Where this comes from">
                          <h3 className={styles.label}>Where this comes from</h3>
                          <p className={styles.text}>
                            Raised by {t.participantCount} of {overview.totalParticipants} participants across {t.projectCount} of {plural(overview.projects.length, 'project')}.
                          </p>
                          {t.aliases.length > 0 && <p className={styles.text}>Also known as: {t.aliases.join('; ')}.</p>}
                        </section>
                        {t.needsReview && (
                          <section aria-label="Needs review" data-testid={`review-${t.id}`}>
                            <h3 className={styles.label}>Needs review</h3>
                            <p className={styles.text}>The AI started this theme because no existing one fit. Check that it is not a duplicate and that the title says the problem plainly.</p>
                            {canReview && onReviewed && (
                              <Button kind="tertiary" size="sm" disabled={reviewing} onClick={() => onReviewed(t.id)}>
                                Mark as reviewed
                              </Button>
                            )}
                          </section>
                        )}
                        <PriorityNote theme={t} curation={curation ?? NO_CURATION} />
                        <section aria-label="Theme summary">
                          <h3 className={styles.label}>Theme summary</h3>
                          <p className={styles.text}>{t.summary ?? 'No summary yet.'}</p>
                        </section>
                        <MatchList theme={t} />
                        {curation?.canEdit && <ThemeTools key={`${t.id}:${t.title}`} theme={t} others={overview.themes.filter((x) => x.id !== t.id)} curation={curation} />}
                        <section aria-label="Recommendation">
                          <h3 className={styles.label}>Recommendation</h3>
                          {recs.length === 0 ? (
                            <p className={styles.text}>
                              {t.opportunity ? `An opportunity: raised in ${plural(t.projectCount, 'project')} and no requirement addresses it yet.` : 'No recommendation yet.'}
                            </p>
                          ) : (
                            recs.map((r) => (
                              <p key={r.id} className={styles.text}>
                                <strong>{r.title}</strong>
                                {r.why ? ` ${r.why}` : ''}
                              </p>
                            ))
                          )}
                        </section>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
