import { Link } from 'react-router-dom'
import { Tag } from '@carbon/react'
import type { PulseTopic } from '../../api/client'
import { money } from '../pulse/money'
import styles from './HeardInPulse.module.scss'

// Platform Insights is the suite's home. For an owner with Pulse on, the top of the page says what customers keep raising (Heard) before the themes below say what the team learned.
// Links, not copies: each topic opens in Pulse, and says whether Signal Flow already has a theme for it.
export function HeardInPulse({ topics }: { topics: PulseTopic[] }) {
  const top = topics.slice(0, 3)
  if (!top.length) return null
  return (
    <section className={styles.strip} aria-label="Heard in Pulse" data-testid="heard-in-pulse">
      <div className={styles.head}>
        <h2 className={styles.sectionHeading}>Heard in Pulse</h2>
        <Link to="/pulse" className={styles.more}>
          Open Pulse
        </Link>
      </div>
      <ol className={styles.list}>
        {top.map((t) => (
          <li key={t.id} className={styles.item}>
            <Link to={`/pulse/topics/${t.id}`} className={styles.title} data-testid="heard-topic">
              {t.title}
            </Link>
            <span className={styles.meta}>
              {t.signals} {t.signals === 1 ? 'signal' : 'signals'}, {t.reach} {t.reach === 1 ? 'account' : 'accounts'}
              {t.arr !== null ? `, ${money(t.arr)} ARR` : ''}
              {t.inPlay && t.inPlay.open.count > 0 ? `, ${money(t.inPlay.open.amount)} in play` : ''}
            </span>
            {t.researched.length > 0 ? (
              <Tag type="teal" size="sm">
                Researched
              </Tag>
            ) : (
              <Tag type="gray" size="sm">
                Not researched yet
              </Tag>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
