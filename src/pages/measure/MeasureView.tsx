import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, Dropdown, InlineNotification, Loading, Tag } from '@carbon/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Checkin, MeasureAcross, MeasureAcrossItem, MeasureRequest } from '../../api/client'
import { goalText, readingText, signalText } from '../../../shared/measure.mjs'
import { FilterCards } from '../../components/FilterCards'
import { PageHero } from '../../shell/PageHero'
import { Sparkline } from '../insights/Sparkline'
import { latestOf, MeasurePanel, readingSource } from './MeasurePanel'
import styles from './MeasureView.module.scss'

export type MeasureViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  data?: MeasureAcross
  /** The team and project the list is narrowed to (their ids), or null for all. */
  team: string | null
  project: string | null
  /** A requirement key to have open when the list opens (from a link on a story); read with the project. */
  openKey: string | null
  saving: boolean
  savedAt?: string
  errorText?: string
  onTeam: (id: string | null) => void
  onProject: (id: string | null) => void
  onSave: (storyId: string, body: MeasureRequest) => Promise<unknown>
  onGoProjects: () => void
  /** Opens the Stories board of that project with this requirement's card selected. */
  onViewStory: (projectId: string, key: string) => void
}

type Verdict = Checkin['verdict']

const VERDICTS: { key: Verdict; label: string; tag: 'green' | 'red' | 'gray' }[] = [
  { key: 'worked', label: 'Worked', tag: 'green' },
  { key: 'needs_attention', label: 'Needs attention', tag: 'red' },
  { key: 'too_early', label: 'Too early to tell', tag: 'gray' },
]

const dayLabel = (on: string) => new Date(`${on}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })

function ResultTag({ result }: { result: MeasureAcrossItem['result'] }) {
  const v = VERDICTS.find((x) => x.key === result)
  return (
    <Tag size="sm" type={v ? v.tag : 'outline'}>
      {v ? v.label : 'Not measured yet'}
    </Tag>
  )
}

// Beside the list on a wide window; under the chosen card on a narrower one (a tablet), where there is no room for two columns.
const WIDE = '(min-width: 80rem)'
const subscribeWide = (cb: () => void) => {
  const q = window.matchMedia(WIDE)
  q.addEventListener('change', cb)
  return () => q.removeEventListener('change', cb)
}
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => false)

// What the card shows under its title: the latest reading, from where, and when; with a small chart when there is a series. Nothing when
// there is no reading yet.
function Strip({ item }: { item: MeasureAcrossItem }) {
  const latest = latestOf(item)
  if (!latest) return null
  const reading = readingText(latest.value, item.unit)
  const source = readingSource(item)
  const series = item.trend && item.trend.length >= 2 ? item.trend : null
  return (
    <div className={styles.strip} data-result={item.result} data-testid={`measure-strip-${item.key}`}>
      <div className={styles.stripText}>
        <p className={styles.stripSource}>{source} · {dayLabel(latest.on)}</p>
        <p className={styles.stripValue}>{reading || '–'}</p>
        {latest.note && <p className={styles.stripNote}>{latest.note}</p>}
      </div>
      {series && <Sparkline values={series} trend="steady" label={`Readings, oldest to newest: ${series.join(', ')}`} note={`Sample readings: ${series.join(', ')}`} />}
    </div>
  )
}

function Card({ item, selected, collapsed, showProject, viewOnly, onSelect, onToggle, inlinePanel }: { item: MeasureAcrossItem; selected: boolean; collapsed: boolean; showProject: boolean; viewOnly: boolean; onSelect: () => void; onToggle: () => void; inlinePanel?: React.ReactNode }) {
  const signal = signalText(item)
  const goal = goalText(item)
  const hasStrip = !!latestOf(item)
  return (
    <li className={styles.card} data-testid={`measure-${item.key}`} data-project={item.projectId} data-selected={selected} data-collapsed={collapsed} data-result={item.result ?? 'none'}>
      <div className={styles.top}>
        <Button kind="ghost" size="md" className={styles.select} aria-pressed={selected} aria-label={`${item.projectName}, ${item.key}, ${item.title}`} onClick={onSelect}>
          <span className={styles.selectText}>
            {showProject && <span className={styles.project} data-testid="measure-project">{item.projectName}{item.teamName ? ` · ${item.teamName}` : ''}</span>}
            <span className={styles.reqTitle}>
              <span className={styles.reqKey}>{item.key}</span> {item.title}
            </span>
            <span className={styles.signal}>{[signal, goal].filter(Boolean).join(' · ') || 'No measure yet'}</span>
          </span>
        </Button>
        <span className={styles.statusSlot}>
          {viewOnly && <Tag size="sm" type="outline">View only</Tag>}
          <ResultTag result={item.result} />
          {hasStrip && (
            <Button kind="ghost" size="sm" hasIconOnly renderIcon={collapsed ? ChevronDown : ChevronUp} iconDescription={collapsed ? `Show the reading for ${item.key}` : `Hide the reading for ${item.key}`} tooltipPosition="left" aria-expanded={!collapsed} onClick={onToggle} />
          )}
        </span>
      </div>
      {!collapsed && <Strip item={item} />}
      {inlinePanel}
    </li>
  )
}

type Choice = { id: string | null; label: string }

// Presentational: every requirement of the projects you can see, each with its measure as one sentence, its latest reading and its status,
// narrowed to a team, a project or a result.
export function MeasureView(props: MeasureViewProps) {
  const { state, data, team, project, openKey, saving, savedAt, errorText } = props
  const wide = useWide()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Every card shows its reading by default; "Collapse all" folds them to their top line, and a card can be folded on its own.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // A result picked from the counts: only those requirements are listed. Picking it again shows everything.
  const [only, setOnly] = useState<Verdict | 'none' | null>(null)

  const teams: Choice[] = data
    ? [{ id: null, label: 'All teams' }, ...[...new Map(data.projects.filter((p) => p.teamId).map((p) => [p.teamId as string, p.teamName ?? 'Team'])).entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label))]
    : []
  const projectsHere = data ? data.projects.filter((p) => !team || p.teamId === team) : []
  const projects: Choice[] = [{ id: null, label: 'All projects' }, ...projectsHere.map((p) => ({ id: p.id, label: p.name }))]
  // What the filters leave; the counts are of this, the list also takes the result picked from them.
  const scoped = data ? data.items.filter((i) => (!team || i.teamId === team) && (!project || i.projectId === project)) : []
  const count = (v: Verdict) => scoped.filter((i) => i.result === v).length
  const s = { worked: count('worked'), needsAttention: count('needs_attention'), tooEarly: count('too_early'), notMeasured: scoped.filter((i) => !i.result).length }
  const shown = only ? scoped.filter((i) => (only === 'none' ? !i.result : i.result === only)) : scoped
  const wanted = openKey ? shown.find((i) => i.key === openKey) : undefined
  const selected = shown.find((i) => i.storyId === selectedId) ?? wanted ?? shown[0]
  useEffect(() => {
    if (selected && selected.storyId !== selectedId) setSelectedId(selected.storyId)
  }, [selected, selectedId])
  const toggleCard = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allFolded = shown.length > 0 && shown.every((i) => collapsed.has(i.storyId))
  const pick = (next: Verdict | 'none') => setOnly(only === next ? null : next)
  const STATS: { key: string; label: string; count: number }[] = [
    { key: 'all', label: 'All measurements', count: scoped.length },
    { key: 'worked', label: 'Worked', count: s.worked },
    { key: 'needs_attention', label: 'Needs attention', count: s.needsAttention },
    { key: 'too_early', label: 'Too early to tell', count: s.tooEarly },
    { key: 'none', label: 'Not measured yet', count: s.notMeasured },
  ]
  const canEditAnywhere = !!data?.projects.some((p) => p.canEdit)
  const panel = (item: MeasureAcrossItem, showTitle: boolean) => (
    <MeasurePanel key={item.storyId} item={item} projectId={item.projectId} canEdit={item.canEdit} onSave={props.onSave} onViewStory={(key) => props.onViewStory(item.projectId, key)} showTitle={showTitle} />
  )

  return (
    <div className={styles.page}>
      <PageHero title="Measure" description="Did it work? Say how each requirement will be measured, then come back after launch and record what you see, across every project or one, so the next study starts from results." glow="left">
        {state === 'ready' && canEditAnywhere && (
          <p className={styles.saved} role="status">
            <span className={styles.savedDot} data-saving={saving} aria-hidden />
            {saving ? 'Saving…' : savedAt ? `All changes saved at ${savedAt}` : 'All changes saved'}
          </p>
        )}
      </PageHero>
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading the measures" />}
      {state === 'error' && !errorText && <p className={styles.muted}>The measures could not be loaded.</p>}
      {state === 'empty' && (
        <div className={styles.emptyState}>
          <p className={styles.muted}>Publish a requirements document in a project to put its requirements here.</p>
          <Button kind="primary" size="md" onClick={props.onGoProjects}>
            Go to Projects
          </Button>
        </div>
      )}
      {state === 'ready' && data && (
        <>
          {(teams.length > 2 || projects.length > 2) && (
            <section className={styles.filters} aria-label="Narrow the measurements">
              {teams.length > 2 && (
                <Dropdown
                  id="measure-team"
                  titleText="Team"
                  label="All teams"
                  size="md"
                  items={teams}
                  itemToString={(c) => c?.label ?? ''}
                  selectedItem={teams.find((c) => c.id === team) ?? teams[0]}
                  onChange={({ selectedItem }) => props.onTeam(selectedItem?.id ?? null)}
                />
              )}
              <Dropdown
                id="measure-project"
                titleText="Project"
                label="All projects"
                size="md"
                items={projects}
                itemToString={(c) => c?.label ?? ''}
                selectedItem={projects.find((c) => c.id === project) ?? projects[0]}
                onChange={({ selectedItem }) => props.onProject(selectedItem?.id ?? null)}
              />
            </section>
          )}
          <FilterCards ariaLabel="Results so far" items={STATS} selected={only ?? 'all'} onSelect={(k) => (k === 'all' ? setOnly(null) : pick(k as Verdict | 'none'))} />
          {scoped.length === 0 ? (
            <p className={styles.muted}>Nothing here has any requirements to measure yet: a document with only open questions has nothing to measure.</p>
          ) : (
            <>
              <div className={styles.listTools}>
                <Button kind="ghost" size="sm" onClick={() => setCollapsed(allFolded ? new Set() : new Set(shown.map((i) => i.storyId)))}>
                  {allFolded ? 'Expand all' : 'Collapse all'}
                </Button>
              </div>
              <div className={styles.layout} data-wide={wide}>
                <ul className={styles.list} aria-label="Requirements and their measures">
                  {shown.map((item) => (
                    <Card
                      key={item.storyId}
                      item={item}
                      selected={item.storyId === selected?.storyId}
                      collapsed={collapsed.has(item.storyId)}
                      showProject={!project}
                      viewOnly={canEditAnywhere && !item.canEdit}
                      onSelect={() => setSelectedId(item.storyId)}
                      onToggle={() => toggleCard(item.storyId)}
                      inlinePanel={!wide && item.storyId === selected?.storyId ? panel(item, false) : undefined}
                    />
                  ))}
                </ul>
                {wide && selected && <aside className={styles.aside}>{panel(selected, true)}</aside>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
