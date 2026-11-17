import { InlineNotification, Loading, Tag } from '@carbon/react'
import { Link } from 'react-router-dom'
import type { MeasureAcrossItem } from '../../api/client'
import { useLaunchSuccess } from '../../api/hooks'
import { goalText, readingText, sentenceText } from '../../../shared/measure.mjs'
import { Sparkline } from '../insights/Sparkline'
import { dayText } from './launchText'
import styles from './SuccessTab.module.scss'

type Measure = Omit<MeasureAcrossItem, 'projectId' | 'projectName' | 'teamId' | 'teamName' | 'canEdit'>

// The three kinds of signal a measure can draw on. A requirement's measure is read as one (a requirement may use several); the family is only a label for where
// the reading comes from, and is what a connected source will fill in later.
const FAMILIES = [
  { key: 'telemetry', label: 'Telemetry', sub: 'Product analytics', tag: 'teal', sources: ['telemetry', 'kpi'], looks: ['How often it is used', 'Adoption and engagement', 'Business numbers'] },
  { key: 'support', label: 'Support', sub: 'Support system', tag: 'purple', sources: ['support_tickets'], looks: ['Tickets on the topic', 'Escalations that lose context', 'Satisfaction on those tickets'] },
  { key: 'feedback', label: 'Feedback', sub: 'What people say', tag: 'gray', sources: ['research'], looks: ['Follow-up interviews on the same themes', 'Surveys and comments', 'The original research is the baseline'] },
] as const

const VERDICT: Record<string, { label: string; tag: 'green' | 'red' | 'gray' }> = {
  worked: { label: 'Worked', tag: 'green' },
  needs_attention: { label: 'Needs attention', tag: 'red' },
  too_early: { label: 'Too early to tell', tag: 'gray' },
}

const familyOf = (m: Measure) => FAMILIES.find((f) => (f.sources as readonly string[]).includes(m.source ?? ''))

// The launch's "How will we know it worked?": read-only reference. What success was defined to be, each requirement's measure and its latest reading, where the readings
// will come from, and when to look. Edited on Measure; it will complete the loop later (see docs/SUCCESS-METRICS.md).
export function SuccessTab({ launchId }: { launchId: string }) {
  const q = useLaunchSuccess(launchId)
  if (q.isPending) return <Loading small withOverlay={false} description="Loading" />
  if (q.isError || !q.data) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Not available" subtitle="This could not be loaded. Try again in a moment." />
  const d = q.data
  if (!d.published) {
    return (
      <div className={styles.page} data-testid="success-tab">
        <p className={styles.empty}>The measures appear once the requirements are published: each requirement gets one, and this page shows how it is going.</p>
      </div>
    )
  }
  const measures = d.measures as Measure[]
  return (
    <div className={styles.page} data-testid="success-tab">
      <section className={styles.section} aria-labelledby="success-goal">
        <p className={styles.group}>What success looks like</p>
        <h2 id="success-goal" className={styles.heading}>{d.goals && d.goals.length ? 'What the brief set out to do' : 'No goals written yet'}</h2>
        {d.problem && <p className={styles.problem}>{d.problem}</p>}
        {d.goals && d.goals.length > 0 && (
          <ul className={styles.goals}>
            {d.goals.map((g, i) => <li key={i}>{g}</li>)}
          </ul>
        )}
        <p className={styles.meta}>From the product brief, step 3: goals and success metrics.</p>
      </section>

      <section className={styles.section} aria-labelledby="success-measures">
        <p className={styles.group}>The measures</p>
        <h2 id="success-measures" className={styles.heading}>One for each requirement</h2>
        {measures.length === 0 && <p className={styles.empty}>No requirements yet.</p>}
        <div className={styles.measures}>
          {measures.map((m) => {
            const latest = m.checkins.length ? m.checkins[m.checkins.length - 1] : null
            const sentence = sentenceText(m) || [m.metric, goalText(m)].filter(Boolean).join(' · ')
            const family = familyOf(m)
            const v = m.result ? VERDICT[m.result] : null
            return (
              <div key={m.key} className={styles.measure} data-testid={`success-measure-${m.key}`}>
                <div className={styles.what}>
                  <h3 className={styles.name}>{m.key} · {m.title}</h3>
                  {m.whyItMatters && <p className={styles.why}>{m.whyItMatters}</p>}
                  {family && <Tag size="sm" type={family.tag}>{family.label}</Tag>}
                </div>
                <div>
                  <p className={styles.key}>How we will know</p>
                  <p className={styles.sentence}>{sentence || 'No measure set yet.'}</p>
                </div>
                <div className={styles.read}>
                  <div>
                    <p className={styles.key}>{latest ? `Latest reading · ${dayText(latest.on)}` : 'Latest reading'}</p>
                    <p className={styles.reading}>{latest ? readingText(latest.value, m.unit) || '–' : 'Not read yet'}</p>
                    {v ? <Tag size="sm" type={v.tag}>{v.label}</Tag> : <Tag size="sm" type="outline">Not read</Tag>}
                  </div>
                  {m.trend && m.trend.length >= 2 && <Sparkline variant="area" values={m.trend} trend="steady" label={`Readings, oldest to newest: ${m.trend.join(', ')}`} note={`Readings: ${m.trend.join(', ')}`} />}
                </div>
              </div>
            )
          })}
        </div>
        <Link className={styles.link} to={`/measure?project=${d.projectId}`}>Edit the measures in Measure</Link>
      </section>

      <section className={styles.section} aria-labelledby="success-where">
        <p className={styles.group}>Where we will look</p>
        <h2 id="success-where" className={styles.heading}>Three kinds of signal</h2>
        <div className={styles.sources}>
          {FAMILIES.map((f) => {
            const using = measures.filter((m) => (f.sources as readonly string[]).includes(m.source ?? ''))
            const read = using.some((m) => m.checkins.length > 0)
            return (
              <div key={f.key} className={styles.source} data-testid={`success-source-${f.key}`}>
                <Tag size="sm" type={f.tag}>{f.label}</Tag>
                <h3 className={styles.name}>{f.sub}</h3>
                <ul className={styles.looks}>{f.looks.map((l) => <li key={l}>{l}</li>)}</ul>
                <p className={styles.meta}>{using.length ? `Used by ${using.map((m) => m.key).join(', ')}` : 'No measure uses this yet'}</p>
                <Tag size="sm" type="outline">{read ? 'Read by hand today' : using.length ? 'Not read yet' : 'Not connected'}</Tag>
              </div>
            )
          })}
        </div>
      </section>

      <section className={styles.section} aria-labelledby="success-when">
        <p className={styles.group}>When we will know</p>
        <h2 id="success-when" className={styles.heading}>Review points after launch</h2>
        {d.reviewPoints.every((p) => p.on === null) ? (
          <p className={styles.empty}>Set a target date for the launch and the review dates appear here.</p>
        ) : (
          <ol className={styles.timeline}>
            {d.reviewPoints.map((p) => (
              <li key={p.key} className={styles.step}>
                <h3 className={styles.name}>{p.label}</h3>
                <p className={styles.meta}>{dayText(p.on)}</p>
              </li>
            ))}
          </ol>
        )}
        {d.reviewer && <p className={styles.meta}>Reviewer: {d.reviewer}. The dates follow the launch’s target date.</p>}
      </section>
    </div>
  )
}
