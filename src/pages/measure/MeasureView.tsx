import { Button, Dropdown, Loading, Tag } from '@carbon/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { LaunchMeasure, MeasureResults } from '../../api/client'
import { MEASURE_KINDS, readingText, sentenceText } from '../../../shared/measure.mjs'
import { PageHero } from '../../shell/PageHero'
import { dayText } from '../launch/launchText'
import styles from './MeasureView.module.scss'

export type MeasureViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  data?: MeasureResults
  /** The team, owner and result the list is narrowed to, or null for all. */
  team: string | null
  owner: string | null
  result: Result | null
  errorText?: string
  onTeam: (id: string | null) => void
  onOwner: (id: string | null) => void
  onResult: (r: Result | null) => void
}

export type Result = NonNullable<LaunchMeasure['result']>
const RESULTS: { key: Result; label: string; short: string; tag: 'green' | 'red' | 'gray' }[] = [
  { key: 'worked', label: 'Worked', short: 'worked', tag: 'green' },
  { key: 'needs_attention', label: 'Needs attention', short: 'needs attention', tag: 'red' },
  { key: 'too_early', label: 'Too early to tell', short: 'too early', tag: 'gray' },
]

// Beside the list on a wide window; under the chosen card on a narrower one (a tablet), where there is no room for two columns.
const WIDE = '(min-width: 80rem)'
const subscribeWide = (cb: () => void) => {
  const q = window.matchMedia(WIDE)
  q.addEventListener('change', cb)
  return () => q.removeEventListener('change', cb)
}
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false)

type Choice = { id: string | null; label: string }
type Project = MeasureResults['themes'][number]['projects'][number]
type Theme = Omit<MeasureResults['themes'][number], 'projects'> & { projects: Project[] }

const kindLabel = (m: LaunchMeasure) => MEASURE_KINDS.find((k) => k.key === m.metricKind)?.label ?? 'Reading'
const latestOf = (m: LaunchMeasure) => m.checkins[m.checkins.length - 1] ?? null
const countOf = (t: Theme, r: Result) => t.projects.reduce((n, p) => n + p.measures.filter((m) => m.result === r).length, 0)
const totalOf = (t: Theme) => t.projects.reduce((n, p) => n + p.measures.length, 0)

// One measure with its result: what was expected (the sentence) beside what was read, tinted by how it went; earlier readings below.
function ResultRow({ m }: { m: LaunchMeasure }) {
  const latest = latestOf(m)
  const v = RESULTS.find((r) => r.key === m.result)
  const sentence = sentenceText(m)
  const earlier = m.checkins.slice(0, -1).reverse()
  return (
    <li className={styles.result} data-result={m.result ?? 'none'} data-testid={`result-${m.id}`}>
      <div className={styles.resultHead}>
        <p className={styles.resultKind}>{kindLabel(m)}</p>
        {v && <Tag size="sm" type={v.tag}>{v.label}</Tag>}
      </div>
      <p className={styles.expected}>{sentence || 'Not described.'}</p>
      {latest && (
        <>
          <p className={styles.reading}>{readingText(latest.value, m.unit) || '–'}</p>
          <p className={styles.asOf}>As of {dayText(latest.on)}</p>
          {latest.note && <p className={styles.note}>{latest.note}</p>}
        </>
      )}
      {earlier.length > 0 && (
        <ul className={styles.earlier} aria-label="Earlier readings">
          {earlier.map((c) => (
            <li key={c.on}>{dayText(c.on)}: {readingText(c.value, m.unit) || '–'}{c.note ? ` · ${c.note}` : ''}</li>
          ))}
        </ul>
      )}
    </li>
  )
}

// The chosen theme: each project that reached it, with its launch's measures and what they showed.
function ThemePanel({ theme }: { theme: Theme }) {
  return (
    <div className={styles.panel} data-testid={`measure-panel-${theme.id ?? 'none'}`}>
      <h2 className={styles.panelTitle}>{theme.title}</h2>
      {theme.projects.map((p) => (
        <section key={p.launchId} className={styles.project} aria-label={p.projectName}>
          <h3 className={styles.projectName}>{p.projectName}</h3>
          <p className={styles.projectMeta}>{[p.teamName, p.ownerName, p.approvedOn ? `Signed off ${dayText(p.approvedOn)}` : null].filter(Boolean).join(' · ')}</p>
          <ul className={styles.results} aria-label={`Results for ${p.projectName}`}>
            {p.measures.map((m) => <ResultRow key={m.id} m={m} />)}
          </ul>
        </section>
      ))}
    </div>
  )
}

function ThemeCard({ theme, selected, onSelect, inlinePanel }: { theme: Theme; selected: boolean; onSelect: () => void; inlinePanel?: React.ReactNode }) {
  const projects = theme.projects.length
  return (
    <li className={styles.card} data-testid={`measure-theme-${theme.id ?? 'none'}`} data-selected={selected}>
      <Button kind="ghost" size="md" className={styles.select} aria-pressed={selected} onClick={onSelect}>
        <span className={styles.selectText}>
          <span className={styles.reqTitle}>{theme.title}</span>
          <span className={styles.signal}>{totalOf(theme)} {totalOf(theme) === 1 ? 'measure' : 'measures'} · {projects} {projects === 1 ? 'project' : 'projects'}</span>
          <span className={styles.counts}>
            {RESULTS.filter((r) => countOf(theme, r.key) > 0).map((r) => <Tag key={r.key} size="sm" type={r.tag}>{countOf(theme, r.key)} {r.short}</Tag>)}
          </span>
        </span>
      </Button>
      {inlinePanel}
    </li>
  )
}

// Presentational: what the launches' measures showed after launch, by theme. Only what has a reading is here. The themes are the cards; the chosen one's projects and
// results are beside them (or under the card on a narrower window). Narrowed to a team, an owner or a result.
export function MeasureView(props: MeasureViewProps) {
  const { state, data, team, owner, result, errorText } = props
  const wide = useWide()
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined)

  const projectsAll = data ? data.themes.flatMap((t) => t.projects) : []
  const teams: Choice[] = [{ id: null, label: 'All teams' }, ...[...new Map(projectsAll.filter((p) => p.teamId).map((p) => [p.teamId as string, p.teamName ?? 'Team'])).entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))]
  const owners: Choice[] = [{ id: null, label: 'All owners' }, ...[...new Map(projectsAll.filter((p) => p.ownerId).map((p) => [p.ownerId as string, p.ownerName ?? 'Owner'])).entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))]
  // The team and owner narrow what the counts are of; the result narrows the list too. A theme left with nothing is gone.
  const scoped: Theme[] = (data?.themes ?? [])
    .map((t) => ({ ...t, projects: t.projects.filter((p) => (!team || p.teamId === team) && (!owner || p.ownerId === owner)) }))
    .filter((t) => t.projects.length > 0)
  // A measure can sit under several themes; the dropdown counts each one once.
  const countAll = (r: Result) => new Set(scoped.flatMap((t) => t.projects.flatMap((p) => p.measures.filter((m) => m.result === r).map((m) => m.id)))).size
  const shown: Theme[] = scoped
    .map((t) => ({ ...t, projects: t.projects.map((p) => ({ ...p, measures: result ? p.measures.filter((m) => m.result === result) : p.measures })).filter((p) => p.measures.length > 0) }))
    .filter((t) => t.projects.length > 0)
  const selected = shown.find((t) => t.id === selectedId) ?? shown[0]
  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id)
  }, [selected, selectedId])
  const options: { key: Result | 'all'; label: string; disabled?: boolean }[] = [
    { key: 'all', label: 'All' },
    ...RESULTS.map((r) => ({ key: r.key, label: `${r.label} (${countAll(r.key)})`, disabled: countAll(r.key) === 0 && result !== r.key })),
  ]

  return (
    <div className={styles.page}>
      <PageHero title="Measure" description="Did it work? What each launch's measures showed after it went out, by theme, so the next study starts from results. Only what has been read is here." glow="left" />
      {state === 'loading' && <Loading small withOverlay={false} description="Loading the results" />}
      {state === 'error' && <p className={styles.muted}>{errorText ?? 'The results could not be loaded.'}</p>}
      {state === 'empty' && (
        <div className={styles.emptyState} data-testid="measure-empty">
          <p className={styles.muted}>Nothing has been read yet. Results appear here once a launched project has a reading on one of its measures.</p>
        </div>
      )}
      {state === 'ready' && data && (
        <>
          <section className={styles.filters} aria-label="Narrow the results">
              {teams.length > 2 && (
                <Dropdown id="measure-team" titleText="Team" label="All teams" size="md" items={teams} itemToString={(c) => c?.label ?? ''} selectedItem={teams.find((c) => c.id === team) ?? teams[0]} onChange={({ selectedItem }) => props.onTeam(selectedItem?.id ?? null)} />
              )}
              {owners.length > 2 && (
                <Dropdown id="measure-owner" titleText="Owner" label="All owners" size="md" items={owners} itemToString={(c) => c?.label ?? ''} selectedItem={owners.find((c) => c.id === owner) ?? owners[0]} onChange={({ selectedItem }) => props.onOwner(selectedItem?.id ?? null)} />
              )}
              <Dropdown id="measure-result" titleText="Result" label="All" size="md" items={options} itemToString={(c) => c?.label ?? ''} selectedItem={options.find((r) => r.key === (result ?? 'all')) ?? options[0]} onChange={({ selectedItem }) => props.onResult(!selectedItem || selectedItem.key === 'all' ? null : (selectedItem.key as Result))} />
          </section>
          {shown.length === 0 ? (
            <p className={styles.muted}>Nothing matches those choices.</p>
          ) : (
            <div className={styles.layout} data-wide={wide}>
              <ul className={styles.list} aria-label="Themes with results">
                {shown.map((t) => (
                  <ThemeCard key={t.id ?? 'none'} theme={t} selected={t.id === selected?.id} onSelect={() => setSelectedId(t.id)} inlinePanel={!wide && t.id === selected?.id ? <ThemePanel theme={t} /> : undefined} />
                ))}
              </ul>
              {wide && selected && <aside className={styles.aside}><ThemePanel theme={selected} /></aside>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
