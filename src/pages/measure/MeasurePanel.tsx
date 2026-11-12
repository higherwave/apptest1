import { Button, Dropdown, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { Checkin, MeasureItem, MeasureRequest } from '../../api/client'
import { MEASURE_COMPARISONS, MEASURE_KINDS, readingText, sentenceText } from '../../../shared/measure.mjs'
import { ClampedBlock } from '../requirements/ClampedBlock'
import styles from './MeasurePanel.module.scss'

type Verdict = Checkin['verdict']
type Source = NonNullable<MeasureItem['source']>

/** The four statuses a person picks from. "Not measured yet" is the absence of a reading. */
export const STATUSES: { key: 'none' | Verdict; label: string }[] = [
  { key: 'none', label: 'Not measured yet' },
  { key: 'too_early', label: 'Too early to tell' },
  { key: 'worked', label: 'Worked' },
  { key: 'needs_attention', label: 'Needs attention' },
]
export const SOURCE_LABEL: Record<Source, string> = { telemetry: 'Product analytics', kpi: 'Business KPI', support_tickets: 'Support tickets', research: 'Feedback session', other: 'Other' }
const SOURCES: { key: Source | null; label: string }[] = [{ key: null, label: 'Not set' }, ...(Object.keys(SOURCE_LABEL) as Source[]).map((key) => ({ key, label: SOURCE_LABEL[key] }))]

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const clean = (v: string) => (v.trim() === '' ? null : v.trim())
/** The requirement's one reading: the newest check-in (older rows may have several; the page shows only this one). */
export const latestOf = (item: MeasureItem): Checkin | null => item.checkins[item.checkins.length - 1] ?? null

type PanelProps = {
  item: MeasureItem
  projectId: string
  canEdit: boolean
  onSave: (storyId: string, body: MeasureRequest) => Promise<unknown>
  onViewStory: (key: string) => void
  /** False when the panel sits under its own card, which already shows the title. */
  showTitle?: boolean
}

// One requirement's measure, as one sentence with its latest reading and status. Text fields save when they are left, if they changed; a choice
// from a list, a suggestion or a status saves at once. A requirement keeps only its latest reading: changing the reading or the status replaces it.
export function MeasurePanel({ item, projectId, canEdit, onSave, onViewStory, showTitle = true }: PanelProps) {
  const [detail, setDetail] = useState(item.detail ?? (item.metricKind ? '' : (item.metric ?? '')))
  const [a, setA] = useState(item.valueA ?? (item.comparison ? '' : (item.baseline ?? '')))
  const [b, setB] = useState(item.valueB ?? (item.comparison ? '' : (item.target ?? '')))
  const [unit, setUnit] = useState(item.unit ?? '')
  const latest = latestOf(item)
  const [value, setValue] = useState(latest?.value ?? '')
  const [on, setOn] = useState(latest?.on ?? today())
  const [note, setNote] = useState(latest?.note ?? '')

  // A row saved before the sentence existed is shown as "Something else" with its own words, and becomes a sentence the first time it is saved.
  const kind = item.metricKind ?? 'other'
  const comparison = item.comparison ?? (item.metricKind || item.metric || item.baseline || item.target ? (item.baseline ? 'change' : 'reach') : 'change')
  const cmp = MEASURE_COMPARISONS.find((c) => c.key === comparison)!
  const kindInfo = MEASURE_KINDS.find((k) => k.key === kind)!

  const parts = (over: Partial<{ kind: string; detail: string; comparison: string; a: string; b: string; unit: string }> = {}) => ({
    metricKind: (over.kind ?? kind) as MeasureRequest['metricKind'],
    detail: clean(over.detail ?? detail),
    comparison: (over.comparison ?? comparison) as MeasureRequest['comparison'],
    valueA: clean(over.a ?? a),
    valueB: clean(over.b ?? b),
    unit: clean(over.unit ?? unit),
  })
  const body = (over: Partial<MeasureRequest> = {}, partsOver?: Parameters<typeof parts>[0]): MeasureRequest => ({ ...parts(partsOver), source: item.source, checkins: item.checkins, ...over })
  const save = (over?: Partial<MeasureRequest>, partsOver?: Parameters<typeof parts>[0]) => void onSave(item.storyId, body(over, partsOver))

  // Leaving a sentence field saves it, when it changed.
  const same = (x: string, y: string | null) => (clean(x) ?? null) === (y ?? null)
  const leave = (field: 'detail' | 'a' | 'b' | 'unit') => {
    const changed = field === 'detail' ? !same(detail, item.detail ?? (item.metricKind ? null : item.metric)) : field === 'a' ? !same(a, item.valueA ?? (item.comparison ? null : item.baseline)) : field === 'b' ? !same(b, item.valueB ?? (item.comparison ? null : item.target)) : !same(unit, item.unit)
    if (changed) save()
  }

  // The reading and the status travel together as one check-in; "Not measured yet" has none.
  const checkinFor = (verdict: Verdict | 'none', over: { value?: string; on?: string; note?: string } = {}): Checkin[] =>
    verdict === 'none' ? [] : [{ on: over.on ?? on, value: (over.value ?? value).trim(), verdict, note: clean(over.note ?? note) }]
  const status: Verdict | 'none' = latest ? latest.verdict : 'none'
  const setStatus = (next: Verdict | 'none') => {
    if (next === status) return
    if (next === 'none') {
      setValue('')
      setNote('')
    }
    save({ checkins: checkinFor(next) })
  }
  const leaveReading = () => {
    const changed = !latest ? value.trim() !== '' : value.trim() !== latest.value
    if (!changed) return
    // A reading with no status yet is "too early to tell"; a cleared reading keeps the status it has.
    save({ checkins: checkinFor(status === 'none' && value.trim() ? 'too_early' : status) })
  }
  const leaveDate = () => {
    if (latest && /^\d{4}-\d{2}-\d{2}$/.test(on) && on !== latest.on) save({ checkins: checkinFor(status) })
  }
  const leaveNote = () => {
    if (latest && (clean(note) ?? null) !== (latest.note ?? null)) save({ checkins: checkinFor(status) })
  }

  const sentence = sentenceText({ metricKind: item.metricKind, detail: item.detail, comparison: item.comparison, valueA: item.valueA, valueB: item.valueB, unit: item.unit, metric: item.metric })
  const reading = latest ? readingText(latest.value, item.unit) : ''

  return (
    <div className={styles.panel} data-testid={`measure-panel-${item.key}`} aria-label={`${item.key} measure`}>
      {showTitle && (
        <div className={styles.titleBlock}>
          <p className={styles.key}>{item.key}</p>
          <h3 className={styles.title}>{item.title}</h3>
        </div>
      )}
      {(item.whyItMatters ?? item.summary) && (
        <ClampedBlock label={`why ${item.key} matters`}>
          <p className={styles.why}>{item.whyItMatters ?? item.summary}</p>
        </ClampedBlock>
      )}

      <fieldset className={styles.sentence} disabled={!canEdit}>
        <legend className={styles.legend}>How we will know it worked</legend>
        <div className={styles.flow} data-testid={`measure-sentence-${item.key}`}>
          <span className={styles.words}>We’ll know this worked when</span>
          <Dropdown
            id={`measure-kind-${item.key}`}
            className={styles.kind}
            type="inline"
            size="sm"
            titleText="What is measured"
            hideLabel
            label="What is measured"
            items={MEASURE_KINDS}
            itemToString={(k) => k?.label ?? ''}
            selectedItem={kindInfo}
            disabled={!canEdit}
            onChange={({ selectedItem }) => selectedItem && selectedItem.key !== kind && save({}, { kind: selectedItem.key })}
          />
          <TextInput
            id={`measure-detail-${item.key}`}
            className={styles.detail}
            size="sm"
            labelText="Detail"
            hideLabel
            placeholder={kind === 'other' ? 'what you will measure' : 'details'}
            readOnly={!canEdit}
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            onBlur={() => leave('detail')}
          />
          <Dropdown
            id={`measure-comparison-${item.key}`}
            className={styles.comparison}
            type="inline"
            size="sm"
            titleText="How it is compared"
            hideLabel
            label="How it is compared"
            items={MEASURE_COMPARISONS}
            itemToString={(c) => c?.label ?? ''}
            selectedItem={cmp}
            disabled={!canEdit}
            onChange={({ selectedItem }) => selectedItem && selectedItem.key !== comparison && save({}, { comparison: selectedItem.key })}
          />
          <TextInput id={`measure-a-${item.key}`} className={styles.value} size="sm" labelText={cmp.two ? 'First value' : 'Value'} hideLabel placeholder="value" readOnly={!canEdit} value={a} onChange={(e) => setA(e.target.value)} onBlur={() => leave('a')} />
          {cmp.two && (
            <>
              <span className={styles.words}>{cmp.mid}</span>
              <TextInput id={`measure-b-${item.key}`} className={styles.value} size="sm" labelText="Second value" hideLabel placeholder="value" readOnly={!canEdit} value={b} onChange={(e) => setB(e.target.value)} onBlur={() => leave('b')} />
            </>
          )}
          <TextInput id={`measure-unit-${item.key}`} className={styles.unit} size="sm" labelText="Unit or period" hideLabel placeholder="unit or period" readOnly={!canEdit} value={unit} onChange={(e) => setUnit(e.target.value)} onBlur={() => leave('unit')} />
          <span className={styles.words}>.</span>
        </div>
        {sentence && <p className={styles.srOnly}>{sentence}</p>}
        {canEdit && kindInfo.details.length > 0 && (
          <div className={styles.suggest} role="group" aria-label={`Common details for ${kindInfo.label.toLowerCase()}`}>
            <span className={styles.suggestLabel}>Common details:</span>
            {kindInfo.details.map((d) => (
              <Button key={d} kind="tertiary" size="sm" className={styles.suggestion} onClick={() => { setDetail(d); save({}, { detail: d }) }}>
                {d}
              </Button>
            ))}
          </div>
        )}
        <Dropdown
          id={`measure-source-${item.key}`}
          className={styles.source}
          size="sm"
          titleText="Where the number comes from"
          label="Not set"
          items={SOURCES}
          itemToString={(x) => x?.label ?? ''}
          selectedItem={SOURCES.find((x) => x.key === item.source) ?? SOURCES[0]}
          disabled={!canEdit}
          onChange={({ selectedItem }) => selectedItem && selectedItem.key !== item.source && save({ source: selectedItem.key })}
        />
      </fieldset>

      <section className={styles.latest} aria-label={`Latest reading for ${item.key}`} data-status={status}>
        <h4 className={styles.head}>Latest reading{item.source ? ` · ${SOURCE_LABEL[item.source]}` : ''}</h4>
        <p className={styles.big} data-testid={`measure-reading-${item.key}`}>
          {reading || '–'}
        </p>
        {canEdit ? (
          <div className={styles.readingFields}>
            <TextInput id={`measure-value-${item.key}`} size="sm" labelText="Reading" placeholder="for example 11" value={value} onChange={(e) => setValue(e.target.value)} onBlur={leaveReading} />
            <TextInput id={`measure-on-${item.key}`} size="sm" type="date" labelText="As of" disabled={!latest} value={on} onChange={(e) => setOn(e.target.value)} onBlur={leaveDate} />
            <TextInput id={`measure-note-${item.key}`} className={styles.noteField} size="sm" labelText="Note (optional)" placeholder={latest ? 'what it showed' : 'choose a status or enter a reading first'} disabled={!latest} value={note} onChange={(e) => setNote(e.target.value)} onBlur={leaveNote} />
          </div>
        ) : (
          latest && <p className={styles.meta}>{latest.note}</p>
        )}
      </section>

      <div className={styles.statusBlock}>
        <h4 className={styles.head}>Status</h4>
        <div className={styles.statuses} role="group" aria-label={`Status of ${item.key}`}>
          {STATUSES.map((s) => (
            <Button key={s.key} kind={status === s.key ? 'primary' : 'tertiary'} size="md" className={styles.statusButton} aria-pressed={status === s.key} data-status={s.key} disabled={!canEdit} onClick={() => setStatus(s.key)}>
              {s.label}
            </Button>
          ))}
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
