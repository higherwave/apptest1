import { ChevronDown, ChevronUp, Close } from '@carbon/icons-react'
import { Button, Dropdown, InlineNotification, Loading, Tag, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { Checkin, Measure, MeasureItem, MeasureRequest } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { ClampedBlock } from '../requirements/ClampedBlock'
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
type Source = NonNullable<MeasureItem['source']>

const VERDICTS: { key: Verdict; label: string; tag: 'green' | 'red' | 'gray' }[] = [
  { key: 'worked', label: 'Worked', tag: 'green' },
  { key: 'needs_attention', label: 'Needs attention', tag: 'red' },
  { key: 'too_early', label: 'Too early to tell', tag: 'gray' },
]
const SOURCES: { key: Source | null; label: string }[] = [
  { key: null, label: 'Not set' },
  { key: 'telemetry', label: 'Telemetry' },
  { key: 'kpi', label: 'Business KPI' },
  { key: 'research', label: 'Research' },
  { key: 'other', label: 'Other' },
]

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayLabel = (on: string) => new Date(`${on}T00:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
const clean = (v: string) => (v.trim() === '' ? null : v.trim())

function ResultTag({ result }: { result: MeasureItem['result'] }) {
  const v = VERDICTS.find((x) => x.key === result)
  return (
    <Tag size="sm" type={v ? v.tag : 'outline'}>
      {v ? v.label : 'Not measured'}
    </Tag>
  )
}

// Opened: how we will know it worked on the left, the findings recorded since on the right. The text fields save when they are left,
// if they changed; the source, and adding or removing a finding, save as soon as they are chosen.
function RowBody({ item, projectId, canEdit, onSave, onViewStory }: { item: MeasureItem; projectId: string; canEdit: boolean; onSave: MeasureViewProps['onSave']; onViewStory: MeasureViewProps['onViewStory'] }) {
  const [metric, setMetric] = useState(item.metric ?? '')
  const [baseline, setBaseline] = useState(item.baseline ?? '')
  const [target, setTarget] = useState(item.target ?? '')
  const [on, setOn] = useState(today())
  const [value, setValue] = useState('')
  const [verdict, setVerdict] = useState<Verdict>('too_early')
  const body = (extra: Partial<MeasureRequest> = {}): MeasureRequest => ({
    metric: clean(metric), source: item.source, baseline: clean(baseline), target: clean(target), checkins: item.checkins, ...extra,
  })
  const commit = (field: 'metric' | 'baseline' | 'target', v: string) => {
    if (clean(v) !== item[field]) void onSave(item.storyId, body())
  }
  const add = () => {
    if (!value.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return
    const next: Checkin = { on, value: value.trim(), verdict, note: null }
    // Kept oldest first; a finding on the same day as another goes after it.
    const checkins = [...item.checkins, next].map((c, i) => ({ c, i })).sort((a, b) => (a.c.on === b.c.on ? a.i - b.i : a.c.on < b.c.on ? -1 : 1)).map((x) => x.c)
    void onSave(item.storyId, body({ checkins }))
    setValue('')
  }
  const newestFirst = [...item.checkins].map((c, i) => ({ c, i })).reverse()

  return (
    <div id={`measure-body-${item.key}`} className={styles.itemBody}>
      {(item.whyItMatters ?? item.summary) && (
        <ClampedBlock label={`why ${item.key} matters`}>
          <p className={styles.why}>{item.whyItMatters ?? item.summary}</p>
        </ClampedBlock>
      )}

      {item.checkins.length > 0 && (
        <section className={styles.findings} data-result={item.result} aria-label={`Result for ${item.key}`}>
          <div className={styles.findingsHead}>
            <h4 className={styles.colHead}>Findings</h4>
            <ResultTag result={item.result} />
          </div>
            <ul className={styles.checkins} aria-label={`Findings for ${item.key}`}>
              {newestFirst.map(({ c, i }) => {
                const v = VERDICTS.find((x) => x.key === c.verdict)!
                return (
                  <li key={`${c.on}-${i}`} className={styles.checkin}>
                    <div className={styles.checkinLine}>
                      <span className={styles.day}>{dayLabel(c.on)}</span>
                      <Tag size="sm" type={v.tag}>{v.label}</Tag>
                      <span className={styles.seen} title={c.note ? `${c.value}\n\n${c.note}` : c.value}>{c.value}</span>
                      {canEdit && (
                        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription={`Remove the ${dayLabel(c.on)} finding`} tooltipPosition="left" onClick={() => void onSave(item.storyId, body({ checkins: item.checkins.filter((_, j) => j !== i) }))} />
                      )}
                    </div>
                    {c.note && <p className={styles.noteText}>{c.note}</p>}
                  </li>
                )
              })}
            </ul>
        </section>
      )}

      <div className={styles.split}>
        <div className={styles.cell}>
          <h4 className={styles.colHead}>How we will know it worked</h4>
          <p className={styles.muted}>Record expectations, source data, and metrics</p>
          <TextInput
            id={`measure-metric-${item.key}`}
            labelText="What will tell us?"
            placeholder="For example: support calls about booking fees each week"
            readOnly={!canEdit}
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            onBlur={() => commit('metric', metric)}
          />
          <Dropdown
            id={`measure-source-${item.key}`}
            titleText="Where the number comes from"
            label="Not set"
            disabled={!canEdit}
            items={SOURCES}
            itemToString={(x) => x?.label ?? ''}
            selectedItem={SOURCES.find((x) => x.key === item.source) ?? SOURCES[0]}
            onChange={({ selectedItem }) => selectedItem && void onSave(item.storyId, body({ source: selectedItem.key }))}
          />
          <div className={styles.pair}>
            <TextInput id={`measure-baseline-${item.key}`} labelText="Before" placeholder="120 a week" readOnly={!canEdit} value={baseline} onChange={(e) => setBaseline(e.target.value)} onBlur={() => commit('baseline', baseline)} />
            <TextInput id={`measure-target-${item.key}`} labelText="Goal" placeholder="60 a week" readOnly={!canEdit} value={target} onChange={(e) => setTarget(e.target.value)} onBlur={() => commit('target', target)} />
          </div>
        </div>

        <div className={styles.cell}>
          <h4 className={styles.colHead}>Add a finding</h4>
          <p className={styles.muted}>Record what you see after launch, and whether it worked</p>
          {canEdit && (
            <form
              className={styles.add}
              aria-label={`Add a finding for ${item.key}`}
              onSubmit={(e) => {
                e.preventDefault()
                add()
              }}
            >
              <div className={styles.pair}>
                <TextInput id={`measure-on-${item.key}`} type="date" labelText="Date" value={on} onChange={(e) => setOn(e.target.value)} />
                <Dropdown
                  id={`measure-verdict-${item.key}`}
                  titleText="Verdict"
                  label="Too early to tell"
                  items={VERDICTS}
                  itemToString={(x) => x?.label ?? ''}
                  selectedItem={VERDICTS.find((x) => x.key === verdict)}
                  onChange={({ selectedItem }) => selectedItem && setVerdict(selectedItem.key)}
                />
              </div>
              <div className={styles.valueCell}>
                <TextArea id={`measure-value-${item.key}`} labelText="What did you see?" placeholder="For example: calls about fees fell to 55 a week, and the support team says the questions are easier" rows={5} maxCount={2000} enableCounter={false} value={value} onChange={(e) => setValue(e.target.value)} />
              </div>
              <Button kind="secondary" size="sm" type="submit" disabled={!value.trim()}>
                Add finding
              </Button>
            </form>
          )}
          {!canEdit && item.checkins.length === 0 && <p className={styles.muted}>No findings yet.</p>}
        </div>
      </div>

      <div className={styles.foot}>
        <a
          className={styles.storyLink}
          href={`/projects/${projectId}/stories?open=${encodeURIComponent(item.key)}`}
          onClick={(e) => {
            e.preventDefault()
            onViewStory(item.key)
          }}
        >
          Story →
        </a>
      </div>
    </div>
  )
}

function Row({ item, projectId, canEdit, open, onToggle, onSave, onViewStory }: { item: MeasureItem; projectId: string; canEdit: boolean; open: boolean; onToggle: () => void; onSave: MeasureViewProps['onSave']; onViewStory: MeasureViewProps['onViewStory'] }) {
  return (
    <li className={styles.item} data-testid={`measure-${item.key}`} data-open={open} data-result={item.result ?? 'none'}>
      <h3 className={styles.itemHead}>
        <Button kind="ghost" size="md" className={styles.headButton} renderIcon={open ? ChevronUp : ChevronDown} aria-expanded={open} aria-controls={`measure-body-${item.key}`} onClick={onToggle}>
          <span className={styles.headText}>
            <span className={styles.reqTitle}>
              {item.key} — {item.title}
            </span>
            <span className={styles.status}>
              {item.checkins.length > 0 && (
                <span className={styles.count}>
                  {item.checkins.length} {item.checkins.length === 1 ? 'finding' : 'findings'}
                </span>
              )}
              <ResultTag result={item.result} />
            </span>
          </span>
        </Button>
      </h3>
      {open && <RowBody item={item} projectId={projectId} canEdit={canEdit} onSave={onSave} onViewStory={onViewStory} />}
    </li>
  )
}

// Presentational: the requirements of the published document with how each will be measured and what the findings have shown.
export function MeasureView(props: MeasureViewProps) {
  const { state, measure, canEdit, saving, savedAt, errorText } = props
  const [opened, setOpened] = useState<Set<string>>(new Set())
  // A result picked from the counts: only those requirements are listed, all opened. Picking it again shows everything, folded.
  const [only, setOnly] = useState<Verdict | 'none' | null>(null)
  const toggle = (id: string) => setOpened((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const s = measure?.summary
  const shown = measure ? (only ? measure.items.filter((i) => (only === 'none' ? !i.result : i.result === only)) : measure.items) : []
  const pick = (next: Verdict | 'none') => {
    if (!measure) return
    if (only === next) {
      setOnly(null)
      setOpened(new Set())
    } else {
      setOnly(next)
      setOpened(new Set(measure.items.filter((i) => (next === 'none' ? !i.result : i.result === next)).map((i) => i.storyId)))
    }
  }
  const STATS: { key: Verdict | 'none'; label: string; n: number }[] = s
    ? [
        { key: 'worked', label: 'Worked', n: s.worked },
        { key: 'needs_attention', label: 'Needs attention', n: s.needsAttention },
        { key: 'too_early', label: 'Too early to tell', n: s.tooEarly },
        { key: 'none', label: 'Not measured yet', n: s.notMeasured },
      ]
    : []

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
          <section className={styles.summary} aria-label="Results so far">
            {STATS.map((x) => (
              <Button key={x.key} kind="ghost" size="md" className={styles.stat} data-kind={x.key} aria-pressed={only === x.key} disabled={x.n === 0 && only !== x.key} onClick={() => pick(x.key)}>
                <span className={styles.num}>{x.n}</span>
                <span>{x.label}</span>
              </Button>
            ))}
          </section>
          {measure.items.length === 0 ? (
            <p className={styles.muted}>This document has no requirements, only open questions, so there is nothing to measure yet.</p>
          ) : (
            <>
              <div className={styles.listTools}>
                <Button kind="ghost" size="sm" onClick={() => setOpened(shown.every((i) => opened.has(i.storyId)) ? new Set() : new Set(shown.map((i) => i.storyId)))}>
                  {shown.every((i) => opened.has(i.storyId)) ? 'Collapse all' : 'Expand all'}
                </Button>
              </div>
              <ul className={styles.list} aria-label="Requirements and their measures">
                {shown.map((item) => (
                  <Row key={item.storyId} item={item} projectId={measure.projectId} canEdit={canEdit} open={opened.has(item.storyId)} onToggle={() => toggle(item.storyId)} onSave={props.onSave} onViewStory={props.onViewStory} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
