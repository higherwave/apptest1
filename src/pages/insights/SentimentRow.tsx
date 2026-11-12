import { sentimentTop } from '../themes/journeyMap'
import map from '../themes/JourneyView.module.scss'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// The Sentiment row of a platform journey: one point per stage that has a feeling, at the middle of its column, joined by a line.
export function SentimentRow({ stages }: { stages: { name: string; sentiment: number | null }[] }) {
  const points = stages.flatMap((s, i) => (s.sentiment === null ? [] : [{ index: i, sentiment: s.sentiment, left: ((i + 0.5) / stages.length) * 100, top: sentimentTop(s.sentiment) }]))
  const label = points.length ? 'Sentiment by stage: ' + points.map((p) => `${stages[p.index].name} ${p.sentiment < 0 ? 'negative' : 'positive'}`).join(', ') : 'No sentiment to show'
  return (
    <div className={map.row}>
      <div className={map.rowLabel}>Sentiment</div>
      <div className={map.sentiment} role="img" aria-label={label}>
        <span className={map.axisTop}>Positive</span>
        <span className={map.axisBottom}>Negative</span>
        <span className={map.zero} />
        {points.length > 1 && (
          <svg className={map.line} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            <polyline points={points.map((p) => `${p.left},${p.top}`).join(' ')} />
          </svg>
        )}
        {stages.map((s, i) => {
          const p = points.find((x) => x.index === i)
          return (
            <div key={s.name} className={map.track}>
              {p && <span className={cx(map.point, map[`y${Math.round(p.top)}`])} data-tone={p.sentiment < 0 ? 'negative' : 'positive'} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
