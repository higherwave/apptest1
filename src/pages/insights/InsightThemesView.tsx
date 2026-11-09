import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, Dropdown, InlineNotification, Loading, ProgressBar, Search, Tag } from '@carbon/react'
import { useState } from 'react'
import type { InsightsThemes } from '../../api/client'
import { AssignAreaPanel } from '../areas/AssignAreaPanel'
import { CategoryBadge } from '../themes/CategoryBadge'
import { GroupBy } from './GroupBy'
import { Sparkline } from './Sparkline'
import { InsightsHeader } from './InsightsHeader'
import { RecommendationStrip } from './RecommendationStrip'
import { PriorityNote, RecentMerges, type Curation } from './ThemeCuration'
import { ORIGIN_LABEL, STATUS, teamConversations } from './labels'
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
  /** How the table is divided: one list, or a section for each experience category. */
  groupBy?: 'none' | 'area'
  onGroupBy?: (g: 'none' | 'area') => void
}

type Row = InsightsThemes['themes'][number]
type Filter = 'all' | 'recurring' | 'opportunities' | 'needs_attention' | 'worked'

const TREND = { new: 'New', growing: 'Growing', steady: 'Steady', fading: 'Fading' } as const
const FILTERS: { key: Filter; label: string; count: (o: InsightsThemes) => number; keep: (t: Row) => boolean }[] = [
  { key: 'all', label: 'All themes', count: (o) => o.themes.length, keep: () => true },
  { key: 'recurring', label: 'Recurring pain points', count: (o) => o.summary.recurring, keep: (t) => t.projectCount >= 2 && t.category !== 'delight' },
  { key: 'opportunities', label: 'Opportunities', count: (o) => o.summary.opportunities, keep: (t) => t.opportunity },
  { key: 'needs_attention', label: 'Needs attention', count: (o) => o.summary.needsAttention, keep: (t) => t.status === 'needs_attention' },
  { key: 'worked', label: 'Worked', count: (o) => o.summary.worked, keep: (t) => t.status === 'worked' },
]

// One line on how a theme was filed: by the model (with how sure it was) or by hand, and across how many projects. The full list is under "How themes were matched".
function matchLine(t: Row): string | null {
  if (!t.matches.length) return null
  const sure = t.matches.filter((m) => m.method === 'auto' && m.confidence !== null).map((m) => Math.round((m.confidence as number) * 100))
  const hand = t.matches.some((m) => m.method === 'manual')
  const ai = t.matches.some((m) => m.method === 'auto')
  const parts = [
    ai ? `Matched by AI${sure.length ? ` · ${Math.min(...sure) === Math.max(...sure) ? `${sure[0]}%` : `${Math.min(...sure)}–${Math.max(...sure)}%`} sure` : ''}` : null,
    hand ? (ai ? 'some set by hand' : 'Set by hand') : null,
    `in ${plural(t.projectCount, 'project')}`,
  ].filter(Boolean)
  return parts.join(' · ')
}

// What the one-line summary leaves out, as a hover note: the project theme filed here and the model's reason, once for each different match.
function matchDetail(t: Row): string {
  const seen = new Set<string>()
  const lines: string[] = []
  for (const m of t.matches) {
    const line = `${m.themeTitle}${m.method === 'manual' ? ' (set by hand)' : m.confidence !== null ? ` (${Math.round(m.confidence * 100)}%)` : ''}${m.reason ? `: ${m.reason}` : ''}`
    if (!seen.has(line)) {
      seen.add(line)
      lines.push(line)
    }
  }
  return lines.join('\n')
}

const ORDERS: { key: 'reach' | 'priority'; label: string }[] = [
  { key: 'reach', label: 'Reach' },
  { key: 'priority', label: 'Suggested priority' },
]

const NO_CURATION: Curation = { canEdit: false, busy: false, onRationale: () => {} }
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Presentational: what the team should do (recommendations), then every theme seen across projects as a row that opens to say where it
// comes from, what it means and what to do about it. Scanning the rows is the point; the evidence lives in each project.
export function InsightThemesView({ state, overview, openId, errorText, onToggle, canReview, reviewing, onReviewed, curation, groupBy = 'none', onGroupBy }: InsightThemesViewProps) {
  const [filter, setFilter] = useState<Filter>('all')
  // A recommendation picked on the strip narrows the table to the themes it covers.
  const [recId, setRecId] = useState<string | null>(null)
  const rec = overview?.recommendations.find((r) => r.id === recId) ?? null
  const byCount = overview ? overview.themes.filter(FILTERS.find((f) => f.key === filter)!.keep) : []
  const byRec = rec ? byCount.filter((t) => rec.themes.some((x) => x.id === t.id)) : byCount
  // Search looks only at the theme's own words: its title, its summary and its other names (not quotes, project names or requirements).
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const narrowed = needle ? byRec.filter((t) => [t.title, t.summary ?? '', ...t.aliases].some((text) => text.toLowerCase().includes(needle))) : byRec
  // Reach is the server's order; Suggested priority follows the rank (delights, which are not ranked, last).
  const [order, setOrder] = useState<'reach' | 'priority'>('reach')
  const filterItems = overview ? FILTERS.map((f) => ({ key: f.key, label: f.label, count: f.count(overview) })) : []
  const shown = order === 'priority' ? [...narrowed].sort((a, b) => (a.priority?.rank ?? 1e9) - (b.priority?.rank ?? 1e9)) : narrowed
  // Grouped by experience category: sections in the order their strongest theme appears in the current order, the themes with no area last.
  const [assigning, setAssigning] = useState<Row | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const sections = (() => {
    const by = new Map<string, { key: string; name: string; rows: Row[] }>()
    for (const t of shown) {
      const key = t.area?.id ?? 'unassigned'
      const sec = by.get(key) ?? { key, name: t.area?.name ?? 'Unassigned', rows: [] }
      sec.rows.push(t)
      by.set(key, sec)
    }
    return [...by.values()].sort((a, b) => Number(a.key === 'unassigned') - Number(b.key === 'unassigned'))
  })()
  const renderRow = (t: Row, overview: InsightsThemes) => {
                const open = t.id === openId
                const recs = overview.recommendations.filter((r) => r.themes.some((x) => x.id === t.id))
                return (
                  <li key={t.id} className={styles.item} data-testid={`platform-theme-${t.id}`} data-open={open}>
                    <Button kind="ghost" size="md" className={styles.headButton} renderIcon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={`theme-body-${t.id}`} onClick={() => onToggle(t.id)}>
                      <span className={styles.columns}>
                        <span className={styles.rowHead}>
                          <span className={styles.rowTitle}>{t.title}</span>
                          {open && matchLine(t) && <span className={styles.matchLine} title={matchDetail(t)}>{matchLine(t)}</span>}
                        </span>
                        <span className={styles.chips}>
                          <CategoryBadge category={t.category} quiet />
                          {t.needsReview && <Tag size="sm" type="gray">New · review</Tag>}
                          {order === 'priority' && t.priority && <Tag size="sm" type="gray">#{t.priority.rank}</Tag>}
                          {t.opportunity && <Tag size="sm" type="gray">Opportunity</Tag>}
                        </span>
                        <span>
                          <Tag size="sm" type="gray" data-testid={`origin-${t.id}`}>{ORIGIN_LABEL[t.origin]}</Tag>
                        </span>
                        <span>
                          <Tag size="sm" type="gray">{STATUS[t.status].label}</Tag>
                        </span>
                        <span>{t.trend && <Sparkline values={t.trendSeries} trend={t.trend} label={`Trend: ${TREND[t.trend]}`} note={`${TREND[t.trend]}: share of each project’s participants, oldest project first: ${t.trendSeries.map((s) => `${Math.round(s * 100)}%`).join(', ')}`} />}</span>
                        <span className={styles.rowCount}>
                          <span className={styles.count} title={`${t.participantCount} of ${overview.totalParticipants} participants in ${plural(t.projectCount, 'project')}`}>
                            {t.participantCount} of {overview.totalParticipants} <span className={styles.muted}>· {plural(t.projectCount, 'project')}</span>
                          </span>
                          <ProgressBar label={`${t.title}: participants`} hideLabel size="small" value={t.participantCount} max={Math.max(overview.totalParticipants, 1)} />
                        </span>
                      </span>
                    </Button>
                    {open && (
                      <div id={`theme-body-${t.id}`} className={styles.detail}>
                        <section aria-label="Recommendation" className={styles.banner} data-testid={`recommendation-${t.id}`}>
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
                        <section aria-label="Where this comes from">
                          <h3 className={styles.label}>Where this comes from</h3>
                          <p className={styles.text}>
                            {t.origin === 'team'
                              ? `Heard only in ${teamConversations(t.teamSessions)}, so no customer has raised it in a study yet and it does not count toward reach.`
                              : `Raised by ${t.participantCount} of ${overview.totalParticipants} participants across ${t.projectCount} of ${plural(overview.projects.length, 'project')}.${t.teamSessions > 0 ? ` Also discussed in ${teamConversations(t.teamSessions)}, which confirms it but does not count toward reach.` : ''}`}
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
                        {t.area && (
                          <section aria-label="Experience category" data-testid={`area-${t.id}`}>
                            <h3 className={styles.label}>Experience category</h3>
                            <p className={styles.text}>
                              {t.areaFiledByHand ? <>Filed under <strong>{t.area.name}</strong> by a person.</> : <>Filed under <strong>{t.area.name}</strong>.</>}
                            </p>
                            {t.areaFiledByHand && curation?.canEdit && curation.onClearArea && (
                              <Button kind="tertiary" size="sm" disabled={curation.busy} data-testid={`area-undo-${t.id}`} onClick={() => curation.onClearArea!(t.id)}>
                                Undo: take it out of {t.area.name}
                              </Button>
                            )}
                          </section>
                        )}
                        {!t.area && curation?.canEdit && curation.onAssignArea && (
                          <section aria-label="Experience category" data-testid={`assign-area-${t.id}`}>
                            <h3 className={styles.label}>Experience category</h3>
                            <p className={styles.text}>No experience category yet. Adding it to one files this theme, and the project themes behind it, under that category.</p>
                            <Button kind="tertiary" size="sm" disabled={curation.busy} data-testid={`open-assign-${t.id}`} onClick={() => setAssigning(t)}>
                              Add to Experience Category
                            </Button>
                          </section>
                        )}
                        <PriorityNote theme={t} curation={curation ?? NO_CURATION} />
                        <section aria-label="Theme summary">
                          <h3 className={styles.label}>Theme summary</h3>
                          <p className={styles.text}>{t.summary ?? 'No summary yet.'}</p>
                        </section>
                      </div>
                    )}
                  </li>
                )
  }
  return (
    <div className={styles.page}>
      <InsightsHeader title="Platform Insights" description="What the team has learned across research projects" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading insights" />}
      {state === 'empty' && <p className={styles.empty}>No themes yet. Analyze a project’s transcripts and its themes appear here.</p>}
      {state === 'ready' && overview && (
        <>
          <RecommendationStrip recs={overview.recommendations} selectedId={recId} onSelect={setRecId} />

          <h2 id="themes-heading" className={styles.label}>Themes across projects</h2>

          <div className={styles.controls}>
            <div className={styles.search}>
              <Search size="md" labelText="Search themes" placeholder="Search themes" value={query} onChange={(e) => setQuery(e.target.value)} data-testid="theme-search" />
            </div>
            <div className={styles.pick} data-tour="theme-filters" data-testid="theme-filter">
              <Dropdown
                id="theme-filter"
                titleText="Show"
                label="Show"
                size="md"
                items={filterItems}
                itemToString={(i) => (i ? `${i.label} (${i.count})` : '')}
                selectedItem={filterItems.find((f) => f.key === filter)}
                onChange={({ selectedItem }) => selectedItem && setFilter(selectedItem.key as Filter)}
              />
            </div>
            <div className={styles.pick} data-testid="theme-order">
              <Dropdown
                id="theme-order"
                titleText="Order by"
                label="Order by"
                size="md"
                items={ORDERS}
                itemToString={(i) => i?.label ?? ''}
                selectedItem={ORDERS.find((o) => o.key === order)}
                onChange={({ selectedItem }) => selectedItem && setOrder(selectedItem.key)}
              />
            </div>
            <div className={styles.pick}>{onGroupBy && <GroupBy compact value={groupBy} onChange={onGroupBy} />}</div>
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

          {shown.length === 0 && <p className={styles.empty} role="status">No theme matches {needle ? `“${query.trim()}”` : 'that'}. Search looks at a theme’s title, summary and other names.</p>}
          <section className={styles.table} aria-labelledby="themes-heading">
            <div className={styles.columns} aria-hidden>
              <span className={styles.label}>Themes</span>
              <span className={styles.label}>Type</span>
              <span className={styles.label}>Source</span>
              <span className={styles.label}>Status</span>
              <span className={styles.label}>Trend</span>
              <span className={styles.label}>Participants</span>
            </div>
            {groupBy === 'area' ? (
              sections.map((sec) => {
                const collapsedNow = collapsed.has(sec.key)
                return (
                  <section key={sec.key} className={styles.areaGroup} aria-label={`${sec.name} themes`} data-testid={`area-group-${sec.name}`}>
                    <Button kind="ghost" size="md" className={styles.areaHead} renderIcon={collapsedNow ? ChevronDown : ChevronUp} aria-expanded={!collapsedNow} data-testid={`area-head-${sec.name}`} onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(sec.key)) n.delete(sec.key); else n.add(sec.key); return n })}>
                      <span className={styles.areaName}>{sec.name}</span>
                      <span className={styles.muted}>{plural(sec.rows.length, 'theme')}</span>
                    </Button>
                    {!collapsedNow && (
                      <ul className={styles.list} aria-label={`${sec.name} themes`}>
                        {sec.rows.map((t) => renderRow(t, overview))}
                      </ul>
                    )}
                  </section>
                )
              })
            ) : (
              <ul className={styles.list} aria-label="Themes across projects">
                {shown.map((t) => renderRow(t, overview))}
              </ul>
            )}
          </section>
          <RecentMerges curation={curation ?? NO_CURATION} />
        </>
      )}
      <AssignAreaPanel
        open={!!assigning}
        themeTitle={assigning?.title ?? ''}
        onClose={() => setAssigning(null)}
        onChoose={(areaId) => {
          if (assigning) curation?.onAssignArea?.(assigning.id, areaId)
          setAssigning(null)
        }}
      />
    </div>
  )
}
