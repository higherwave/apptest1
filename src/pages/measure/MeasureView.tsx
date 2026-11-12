import { ChevronDown, ChevronUp } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, Tag } from '@carbon/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { Checkin, Measure, MeasureItem, MeasureRequest } from '../../api/client'
import { goalText, readingText, signalText } from '../../../shared/measure.mjs'
import { FilterCards } from '../../components/FilterCards'
import { Sparkline } from '../insights/Sparkline'
import { ProjectHeader } from '../project/ProjectHeader'
import { latestOf, MeasurePanel, SOURCE_LABEL } from './MeasurePanel'
import styles from './MeasureView.module.scss'

export type MeasureViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  measure?: Measure
  canEdit: boolean
  saving: boolean
  savedAt?: string
  errorText?: string
  onSave: (storyId: string, body: MeasureRequest) => Promise<unknown>
  onGoRequirements: () => void
  /** Opens the Stories board with this requirement's card selected. */
  onViewStory: (key: string) => void
}

type Verdict = Checkin['verdict']

const VERDICTS: { key: Verdict; label: string; tag: 'green' | 'red' | 'gray' }[] = [
  { key: 'worked', label: 'Worked', tag: 'green' },
  { key: 'needs_attention', label: 'Needs attention', tag: 'red' },
  { key: 'too_early', label: 'Too early to tell', tag: 'gray' },
]

const dayLabel = (on: string) => new Date(`${on}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })

function ResultTag({ result }: { result: MeasureItem['result'] }) {
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
function Strip({ item }: { item: MeasureItem }) {
  const latest = latestOf(item)
  if (!latest) return null
  const reading = readingText(latest.value, item.unit)
  const source = item.source ? SOURCE_LABEL[item.source] : 'Reading'
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

function Card({ item, selected, collapsed, onSelect, onToggle, inlinePanel }: { item: MeasureItem; selected: boolean; collapsed: boolean; onSelect: () => void; onToggle: () => void; inlinePanel?: React.ReactNode }) {
  const signal = signalText(item)
  const goal = goalText(item)
  const hasStrip = !!latestOf(item)
  return (
    <li className={styles.card} data-testid={`measure-${item.key}`} data-selected={selected} data-collapsed={collapsed} data-result={item.result ?? 'none'}>
      <div className={styles.top}>
        <Button kind="ghost" size="md" className={styles.select} aria-pressed={selected} aria-label={`${item.key}, ${item.title}`} onClick={onSelect}>
          <span className={styles.selectText}>
            <span className={styles.reqTitle}>
              <span className={styles.reqKey}>{item.key}</span> {item.title}
            </span>
            <span className={styles.signal}>{[signal, goal].filter(Boolean).join(' · ') || 'No measure yet'}</span>
          </span>
        </Button>
        <span className={styles.statusSlot}>
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

// Presentational: the requirements of the published document, each with its measure as one sentence, its latest reading and its status.
export function MeasureView(props: MeasureViewProps) {
  const { state, measure, canEdit, saving, savedAt, errorText } = props
  const wide = useWide()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Every card shows its reading by default; "Collapse all" folds them to their top line, and a card can be folded on its own.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  // A result picked from the counts: only those requirements are listed. Picking it again shows everything.
  const [only, setOnly] = useState<Verdict | 'none' | null>(null)
  const s = measure?.summary
  const shown = measure ? (only ? measure.items.filter((i) => (only === 'none' ? !i.result : i.result === only)) : measure.items) : []
  const selected = shown.find((i) => i.storyId === selectedId) ?? shown[0]
  useEffect(() => {
    if (selected && selected.storyId !== selectedId) setSelectedId(selected.storyId)
  }, [selected, selectedId])
  const toggleCard = (id: string) => setCollapsed((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allFolded = shown.length > 0 && shown.every((i) => collapsed.has(i.storyId))
  const pick = (next: Verdict | 'none') => setOnly(only === next ? null : next)
  const STATS: { key: string; label: string; count: number }[] = s
    ? [
        { key: 'all', label: 'All measurements', count: measure?.items.length ?? 0 },
        { key: 'worked', label: 'Worked', count: s.worked },
        { key: 'needs_attention', label: 'Needs attention', count: s.needsAttention },
        { key: 'too_early', label: 'Too early to tell', count: s.tooEarly },
        { key: 'none', label: 'Not measured yet', count: s.notMeasured },
      ]
    : []
  const panel = (item: MeasureItem, showTitle: boolean) => <MeasurePanel key={item.storyId} item={item} projectId={measure!.projectId} canEdit={canEdit} onSave={props.onSave} onViewStory={props.onViewStory} showTitle={showTitle} />

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <ProjectHeader
          title="Measure"
          description="Did it work? Say how each requirement will be measured, then come back after launch and record what you see, so the next study starts from results."
        />
        {state === 'ready' && canEdit && (
          <p className={styles.saved} role="status">
            <span className={styles.savedDot} data-saving={saving} aria-hidden />
            {saving ? 'Saving…' : savedAt ? `All changes saved at ${savedAt}` : 'All changes saved'}
          </p>
        )}
      </div>
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={errorText} />}
      {state === 'loading' && <Loading small withOverlay={false} description="Loading the measures" />}
      {state === 'error' && !errorText && <p className={styles.muted}>The measures could not be loaded.</p>}
      {state === 'empty' && (
        <div className={styles.emptyState}>
          <p className={styles.muted}>Publish a requirements document to put its requirements here.</p>
          <Button kind="primary" size="md" onClick={props.onGoRequirements}>
            Go to Requirements
          </Button>
        </div>
      )}
      {state === 'ready' && measure && s && (
        <>
          <FilterCards ariaLabel="Results so far" items={STATS} selected={only ?? 'all'} onSelect={(k) => (k === 'all' ? setOnly(null) : pick(k as Verdict | 'none'))} />
          {measure.items.length === 0 ? (
            <p className={styles.muted}>This document has no requirements, only open questions, so there is nothing to measure yet.</p>
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
