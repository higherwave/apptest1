import { Add, TrashCan } from '@carbon/icons-react'
import { Button, Checkbox, Dropdown, InlineNotification, Loading, Tag, TextInput } from '@carbon/react'
import { useEffect, useState } from 'react'
import { ApiRequestError, friendlyMessage, type LaunchMeasure } from '../../api/client'
import { useLaunchSuccess, useSaveLaunchMeasures, useSaveLaunchReading } from '../../api/hooks'
import { MEASURE_COMPARISONS, MEASURE_KINDS, readingText, sentenceText } from '../../../shared/measure.mjs'
import { dayText } from './launchText'
import measureStyles from '../measure/MeasurePanel.module.scss'
import styles from './SuccessTab.module.scss'

type Requirement = { key: string; title: string }
type Draft = Omit<LaunchMeasure, 'checkins' | 'result'>
const toDraft = (m: LaunchMeasure): Draft => ({ id: m.id, metricKind: m.metricKind, detail: m.detail, comparison: m.comparison, valueA: m.valueA, valueB: m.valueB, unit: m.unit, requirementKeys: m.requirementKeys })

// The three most teams measure a release by. Offered when the list is empty; each is a start to complete, not a finished measure.
const STARTER: Pick<Draft, 'metricKind' | 'comparison'>[] = [
  { metricKind: 'adoption', comparison: 'reach' },
  { metricKind: 'engagement', comparison: 'reach' },
  { metricKind: 'time_to_value', comparison: 'below' },
]

const VERDICTS: { key: NonNullable<LaunchMeasure['result']>; label: string; tag: 'green' | 'red' | 'gray' }[] = [
  { key: 'too_early', label: 'Too early to tell', tag: 'gray' },
  { key: 'worked', label: 'Worked', tag: 'green' },
  { key: 'needs_attention', label: 'Needs attention', tag: 'red' },
]
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// After launch: the latest reading of one measure, and (for an editor) the form to record the next. A reading for a day already read replaces it; the latest day is the result.
function ReadingBlock({ launchId, m, index, canEdit, nextDue }: { launchId: string; m: LaunchMeasure; index: number; canEdit: boolean; nextDue: string | null }) {
  const save = useSaveLaunchReading(launchId)
  const latest = m.checkins[m.checkins.length - 1] ?? null
  const [value, setValue] = useState(latest?.value ?? '')
  const [on, setOn] = useState(latest?.on ?? today())
  const [note, setNote] = useState(latest?.note ?? '')
  const [verdict, setVerdict] = useState<LaunchMeasure['result']>(latest?.verdict ?? null)
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)
  const v = VERDICTS.find((x) => x.key === m.result)
  const record = async () => {
    setError(undefined)
    setSaved(false)
    try {
      await save.mutateAsync({ measureId: m.id, body: { on, value: value.trim(), verdict: verdict ?? 'too_early', note: clean(note) } })
      setSaved(true)
    } catch (err) {
      setError(friendlyMessage(err))
    }
  }
  const ready = DAY.test(on) && (value.trim() !== '' || verdict !== null)
  return (
    <div className={styles.reading} data-testid={`reading-${index}`}>
      <div className={styles.readingHead}>
        <p className={styles.key}>{latest ? `Latest reading · ${dayText(latest.on)}` : nextDue ? `No reading yet · next look ${dayText(nextDue)}` : 'No reading yet'}</p>
        {v ? <Tag size="sm" type={v.tag}>{v.label}</Tag> : <Tag size="sm" type="outline">Awaiting a reading</Tag>}
      </div>
      {latest && <p className={styles.readingValue}>{readingText(latest.value, m.unit) || '–'}</p>}
      {latest?.note && <p className={styles.meta}>{latest.note}</p>}
      {canEdit && (
        <div className={styles.readingForm}>
          <TextInput id={`reading-${index}-value`} size="sm" labelText="Reading" placeholder="for example 38" value={value} onChange={(e) => setValue(e.target.value)} />
          <TextInput id={`reading-${index}-on`} size="sm" type="date" labelText="As of" value={on} onChange={(e) => setOn(e.target.value)} />
          <TextInput id={`reading-${index}-note`} className={styles.wide} size="sm" labelText="Note (optional)" placeholder="what it showed" value={note} onChange={(e) => setNote(e.target.value)} />
          <div className={`${styles.wide} ${styles.verdicts}`} role="group" aria-label={`How measure ${index + 1} is going`}>
            {VERDICTS.map((x) => (
              <Button key={x.key} kind={verdict === x.key ? 'primary' : 'tertiary'} size="sm" aria-pressed={verdict === x.key} data-verdict={x.key} onClick={() => setVerdict(x.key)}>{x.label}</Button>
            ))}
          </div>
          <div className={`${styles.wide} ${styles.actions}`}>
            <Button kind="primary" size="sm" data-testid={`reading-save-${index}`} disabled={!ready || save.isPending} onClick={() => void record()}>Save reading</Button>
            {saved && <Tag size="sm" type="green" data-testid={`reading-saved-${index}`}>Saved</Tag>}
          </div>
          {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} />}
        </div>
      )}
    </div>
  )
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
let counter = 0
const blank = (over: Partial<Draft> = {}): Draft => ({ id: `new-${++counter}`, metricKind: 'adoption', detail: null, comparison: 'reach', valueA: null, valueB: null, unit: null, requirementKeys: [], ...over })
const clean = (v: string) => (v.trim() === '' ? null : v.trim())
const same = (a: Draft[], b: LaunchMeasure[]) => JSON.stringify(a) === JSON.stringify(b.map(toDraft))

// One measure as the one sentence, with the requirements it covers as an optional note. Read-only once the expectations are fixed.
function Expectation({ m, index, requirements, editable, onChange, onRemove, children }: { m: Draft; index: number; requirements: Requirement[]; editable: boolean; onChange: (next: Draft) => void; onRemove: () => void; children?: React.ReactNode }) {
  const cmp = MEASURE_COMPARISONS.find((c) => c.key === m.comparison)!
  const kind = MEASURE_KINDS.find((k) => k.key === m.metricKind)!
  const id = `expect-${index}`
  const sentence = sentenceText(m)
  const [showCovers, setShowCovers] = useState(false)
  const covered = requirements.filter((r) => m.requirementKeys.includes(r.key))
  if (!editable) {
    return (
      <li className={styles.expect} data-testid={`expectation-${index}`}>
        <p className={styles.sentence}>{sentence || 'Not described yet.'}</p>
        {covered.length > 0 && <p className={styles.meta}>Covers {covered.map((r) => r.key).join(', ')}</p>}
        {children}
      </li>
    )
  }
  return (
    <li className={styles.expect} data-testid={`expectation-${index}`}>
      <fieldset className={styles.fieldset}>
        <legend className={styles.srOnly}>Measure {index + 1}</legend>
        <div className={measureStyles.flow}>
          <span className={measureStyles.words}>We’ll know this worked when</span>
          <Dropdown id={`${id}-kind`} className={measureStyles.kind} type="inline" size="sm" titleText="What is measured" hideLabel label="What is measured" items={MEASURE_KINDS} itemToString={(k) => k?.label ?? ''} selectedItem={kind} onChange={({ selectedItem }) => selectedItem && onChange({ ...m, metricKind: selectedItem.key as Draft['metricKind'] })} />
          <TextInput id={`${id}-detail`} className={measureStyles.detail} size="sm" labelText="Detail" hideLabel placeholder={m.metricKind === 'other' ? 'what you will measure' : 'details'} value={m.detail ?? ''} onChange={(e) => onChange({ ...m, detail: e.target.value || null })} />
          <Dropdown id={`${id}-comparison`} className={measureStyles.comparison} type="inline" size="sm" titleText="How it is compared" hideLabel label="How it is compared" items={MEASURE_COMPARISONS} itemToString={(c) => c?.label ?? ''} selectedItem={cmp} onChange={({ selectedItem }) => selectedItem && onChange({ ...m, comparison: selectedItem.key as Draft['comparison'] })} />
          <TextInput id={`${id}-a`} className={measureStyles.value} size="sm" labelText={cmp.two ? 'First value' : 'Value'} hideLabel placeholder="value" value={m.valueA ?? ''} onChange={(e) => onChange({ ...m, valueA: e.target.value || null })} />
          {cmp.two && (
            <>
              <span className={measureStyles.words}>{cmp.mid}</span>
              <TextInput id={`${id}-b`} className={measureStyles.value} size="sm" labelText="Second value" hideLabel placeholder="value" value={m.valueB ?? ''} onChange={(e) => onChange({ ...m, valueB: e.target.value || null })} />
            </>
          )}
          <TextInput id={`${id}-unit`} className={measureStyles.unit} size="sm" labelText="Unit or period" hideLabel placeholder="unit or period" value={m.unit ?? ''} onChange={(e) => onChange({ ...m, unit: e.target.value || null })} />
          <span className={measureStyles.words}>.</span>
        </div>
        {sentence && <p className={styles.srOnly}>{sentence}</p>}
      </fieldset>
      <div className={styles.expectFoot}>
        {requirements.length > 0 && (
          <Button kind="ghost" size="sm" aria-expanded={showCovers} data-testid={`expectation-covers-${index}`} onClick={() => setShowCovers(!showCovers)}>
            {covered.length ? `Covers ${covered.map((r) => r.key).join(', ')}` : 'Covers the whole release'} (change)
          </Button>
        )}
        <Button kind="ghost" size="sm" renderIcon={TrashCan} data-testid={`expectation-remove-${index}`} onClick={onRemove}>Remove<span className={styles.srOnly}> measure {index + 1}</span></Button>
      </div>
      {showCovers && (
        <fieldset className={styles.coversList}>
          <legend className={styles.meta}>Requirements it covers (optional). Leave all unchecked when it is about the release as a whole.</legend>
          {requirements.map((r) => (
            <Checkbox key={r.key} id={`${id}-covers-${r.key}`} labelText={`${r.key} · ${r.title}`} checked={m.requirementKeys.includes(r.key)} onChange={(_, { checked }) => onChange({ ...m, requirementKeys: checked ? [...m.requirementKeys, r.key] : m.requirementKeys.filter((k) => k !== r.key) })} />
          ))}
        </fieldset>
      )}
    </li>
  )
}

// The launch's "How will we know it worked?": what the release is expected to do, set before it goes out. The goals from the brief, when we will look (30, 60 and 90
// days after the final approval), and the measures: a short list for the whole release. They change freely until the final decision is a go; then they are the record.
export function SuccessTab({ launchId, canEdit, requirements }: { launchId: string; canEdit: boolean; requirements: Requirement[] }) {
  const q = useLaunchSuccess(launchId)
  const save = useSaveLaunchMeasures(launchId)
  const [draft, setDraft] = useState<Draft[] | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [saved, setSaved] = useState(false)
  const data = q.data
  // A fresh copy of the list whenever the saved version changes (a save of ours, or a reload after someone else's).
  useEffect(() => {
    if (data) setDraft(data.measures.map(toDraft))
  }, [data?.measuresVersion, data?.measures.length])
  if (q.isPending || (data && !draft)) return <Loading small withOverlay={false} description="Loading" />
  if (q.isError || !data || !draft) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Not available" subtitle="This could not be loaded. Try again in a moment." />
  const editable = canEdit && !data.locked
  const dirty = !same(draft, data.measures)
  const change = (i: number, next: Draft) => { setSaved(false); setDraft(draft.map((m, j) => (j === i ? next : m))) }
  const add = (more: Draft[]) => { setSaved(false); setDraft([...draft, ...more]) }
  const onSave = async () => {
    setError(undefined)
    try {
      await save.mutateAsync({
        version: data.measuresVersion,
        body: { measures: draft.map((m) => ({ id: m.id.startsWith('new-') ? null : m.id, metricKind: m.metricKind, detail: clean(m.detail ?? ''), comparison: m.comparison, valueA: clean(m.valueA ?? ''), valueB: clean(m.valueB ?? ''), unit: clean(m.unit ?? ''), requirementKeys: m.requirementKeys })) },
      })
      setSaved(true)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'version_conflict') {
        await q.refetch()
        setError('Someone else changed these measures, so they have been reloaded. Your last change was not saved: enter it again.')
      } else {
        setError(friendlyMessage(err))
      }
    }
  }
  return (
    <div className={styles.page} data-testid="success-tab">
      {data.published && (
        <section className={styles.section} aria-labelledby="success-goal">
          <p className={styles.group}>What success looks like</p>
          <h2 id="success-goal" className={styles.heading}>{data.goals && data.goals.length ? 'What the brief set out to do' : 'No goals written yet'}</h2>
          {data.problem && <p className={styles.problem}>{data.problem}</p>}
          {data.goals && data.goals.length > 0 && (
            <ul className={styles.goals}>
              {data.goals.map((g, i) => <li key={i}>{g}</li>)}
            </ul>
          )}
          <p className={styles.meta}>From the product brief, step 3: goals and success metrics.</p>
        </section>
      )}

      <section className={styles.section} aria-labelledby="success-when">
        <p className={styles.group}>When we will look</p>
        <h2 id="success-when" className={styles.heading}>30, 60 and 90 days after the final approval</h2>
        <p className={styles.meta}>
          {data.approvedOn
            ? `The final decision was a go on ${dayText(data.approvedOn)}. Customers take time to adopt a new feature, so every measure is looked at again at each of these points.`
            : 'The clock starts when the final decision is a go, so there is no date to set. Customers take time to adopt a new feature, so every measure is looked at again at each of these points.'}
        </p>
        <ol className={styles.timeline}>
          {data.reviewPoints.map((p) => (
            <li key={p.key} className={styles.step} data-testid={`review-point-${p.key}`}>
              <h3 className={styles.name}>{p.label}</h3>
              <p className={styles.meta}>{p.on ? dayText(p.on) : 'After the final approval'}</p>
            </li>
          ))}
        </ol>
        {data.reviewer && <p className={styles.meta}>Reviewer: {data.reviewer}.</p>}
      </section>

      <section className={styles.section} aria-labelledby="success-measures">
        <p className={styles.group}>What we expect</p>
        <h2 id="success-measures" className={styles.heading}>How we will know it worked</h2>
        <p className={styles.meta}>
          {data.locked
            ? 'The final decision is a go, so what was expected is fixed.'
            : editable
              ? 'A few measures for the whole release are easier to follow up than one for every requirement. You can change them until the final decision is a go.'
              : 'Only an editor of this team can change them. They are fixed once the final decision is a go.'}
        </p>
        {draft.length === 0 && <p className={styles.empty} data-testid="expectations-empty">{editable ? 'No measures yet.' : 'No measures were set.'}</p>}
        {draft.length > 0 && (
          <ul className={styles.expectations} aria-label="Measures">
            {draft.map((m, i) => (
              <Expectation key={m.id} m={m} index={i} requirements={requirements} editable={editable} onChange={(next) => change(i, next)} onRemove={() => { setSaved(false); setDraft(draft.filter((_, j) => j !== i)) }}>
                {data.locked && data.measures[i] && <ReadingBlock launchId={launchId} m={data.measures[i]} index={i} canEdit={canEdit} nextDue={data.reviewPoints.find((p) => p.on && p.on >= today())?.on ?? null} />}
              </Expectation>
            ))}
          </ul>
        )}
        {editable && (
          <div className={styles.actions}>
            <Button kind="tertiary" size="md" renderIcon={Add} data-testid="expectation-add" disabled={draft.length >= 12} onClick={() => add([blank()])}>Add a measure</Button>
            {draft.length === 0 && <Button kind="tertiary" size="md" data-testid="expectation-starter" onClick={() => add(STARTER.map((s) => blank(s)))}>Start with adoption, engagement and time-to-value</Button>}
            <Button kind="primary" size="md" data-testid="expectation-save" disabled={!dirty || save.isPending} onClick={() => void onSave()}>Save measures</Button>
            {saved && !dirty && <Tag size="sm" type="green" data-testid="expectation-saved">Saved</Tag>}
            {dirty && <Button kind="ghost" size="md" onClick={() => { setSaved(false); setDraft(data.measures.map(toDraft)) }}>Discard changes</Button>}
          </div>
        )}
        {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} data-testid="expectation-error" />}
      </section>
    </div>
  )
}
