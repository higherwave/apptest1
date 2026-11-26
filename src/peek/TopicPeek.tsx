import { ArrowRight } from '@carbon/icons-react'
import { Tag } from '@carbon/react'
import { Link } from 'react-router-dom'
import { usePulseTopic } from '../api/hooks'
import panel from '../components/PanelParts.module.scss'
import { RightPanel } from '../components/RightPanel'
import { SkeletonCard, SkeletonQuotes, SkeletonRegion } from '../components/Skeletons'
import { CHANNEL_LABEL } from '../pages/pulse/channels'
import { moneyFull } from '../pages/pulse/money'
import styles from './Peek.module.scss'
import { peekHref } from './targets'
import { useLast } from './useLast'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const QUOTES = 3

// A Pulse topic, scaled down: how strong it is, why it ranks where it does, and a few of the customer words behind it.
export function TopicPeek({ id, onClose }: { id: string | null; onClose: () => void }) {
  const shown = useLast(id)
  const topic = usePulseTopic(shown ?? undefined, undefined, !!shown)
  const t = topic.data
  return (
    <RightPanel open={!!id} heading={t?.title ?? 'Pulse topic'} label="Pulse topic" onClose={onClose}>
      {shown && (
        <div className={panel.body} data-testid="peek-topic">
          <div className={panel.scroll}>
            {topic.isPending && (
              <SkeletonRegion label="Loading the topic">
                <SkeletonCard lines={2} headingWidth="40%" />
                <SkeletonQuotes count={2} />
              </SkeletonRegion>
            )}
            {topic.isError && <p className={panel.help}>This topic is not available to you, or it no longer exists.</p>}
            {t && (
              <>
                <section className={panel.section}>
                  <div className={styles.chips}>
                    <Tag type="purple" size="sm">Rank #{t.rank} · score {t.score}</Tag>
                    {t.arr !== null && <Tag type="gray" size="sm">{moneyFull(t.arr)} ARR</Tag>}
                  </div>
                  <p className={styles.facts}>
                    {plural(t.signals, 'kept signal')} from {plural(t.reach, 'account')}, heard in {plural(t.channelCount, 'channel')}.
                  </p>
                </section>
                <section className={panel.section} aria-label="Why it ranks here">
                  <h3 className={panel.heading}>Why it ranks here</h3>
                  <dl className={styles.sum}>
                    {t.breakdown.map((b) => (
                      <div key={b.channel} className={styles.sumRow}>
                        <dt>{CHANNEL_LABEL[b.channel]}</dt>
                        <dd>{b.count} × {b.weight} = {b.subtotal}</dd>
                      </div>
                    ))}
                    <div className={styles.sumTotal}>
                      <dt>Score</dt>
                      <dd>{t.score}</dd>
                    </div>
                  </dl>
                </section>
                <section className={panel.section} aria-label="What customers said">
                  <h3 className={panel.heading}>What customers said</h3>
                  <ul className={styles.quotes}>
                    {t.quotes.slice(0, QUOTES).map((q) => (
                      <li key={q.id} className={styles.quote}>
                        <p className={styles.words}>“{q.body}”</p>
                        <p className={styles.who}>{[CHANNEL_LABEL[q.channel], q.saidBy, q.account].filter(Boolean).join(' · ')}</p>
                      </li>
                    ))}
                  </ul>
                  {t.quotes.length > QUOTES && <p className={panel.small}>{t.quotes.length - QUOTES} more on the full page.</p>}
                </section>
              </>
            )}
          </div>
          <div className={panel.actions}>
            <Link className={styles.more} to={peekHref({ kind: 'topic', id: shown })} data-testid="peek-more">
              View details in Pulse
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </RightPanel>
  )
}
