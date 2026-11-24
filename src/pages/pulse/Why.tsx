import type { PulseTopic } from '../../api/client'
import { CHANNEL_LABEL } from './channels'
import styles from './TopicsPage.module.scss'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// "Why it ranks here": the score is each channel's signals times that channel's weight, added up. Shared by the All Topics table and the Top Priorities cards. Changing the weights is a workspace setting, so it lives in Settings, not here.
export function Why({ topic }: { topic: PulseTopic }) {
  return (
    <div className={styles.whyBox}>
      <p className={styles.whyIntro}>
        “{topic.title}” ranks #{topic.rank} because its {plural(topic.signals, 'kept signal')} count for different amounts depending on where they were heard. The score is the total of signals × weight, channel by channel.
      </p>
      <dl className={styles.sum}>
        {topic.breakdown.map((b) => (
          <div key={b.channel} className={styles.sumRow}>
            <dt>{CHANNEL_LABEL[b.channel]}</dt>
            <dd>
              {b.count} × {b.weight} = {b.subtotal}
            </dd>
          </div>
        ))}
        <div className={styles.sumTotal}>
          <dt>Score</dt>
          <dd>{topic.score}</dd>
        </div>
      </dl>
    </div>
  )
}
