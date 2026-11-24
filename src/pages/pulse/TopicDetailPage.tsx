import { useState } from 'react'
import { ArrowLeft } from '@carbon/icons-react'
import { Button, Select, SelectItem, Tag } from '@carbon/react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import type { PulseChannel } from '../../api/client'
import { useMe, usePulseTopic } from '../../api/hooks'
import { PageHero } from '../../shell/PageHero'
import { CHANNEL_LABEL, CHANNELS } from './channels'
import { CreateProjectPanel } from './CreateProjectPanel'
import { PulseNotFound } from './PulseNotFound'
import { moneyFull, oppLine } from './money'
import { useTopicSelection } from './selection'
import styles from './TopicDetailPage.module.scss'

const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`
const TREND = { new: 'New', rising: 'Rising', steady: 'Steady', fading: 'Fading' } as const

// One topic: the customer words behind it, who raised it, and a way to start a project from it (or to add it to a larger choice on Topics).
export function TopicDetailPage() {
  const { id } = useParams()
  const me = useMe()
  const topic = usePulseTopic(id)
  const navigate = useNavigate()
  const { selected, toggle } = useTopicSelection()
  const [channel, setChannel] = useState<'all' | PulseChannel>('all')
  const [creating, setCreating] = useState(false)

  if (!me.data) return null
  if (!me.data.features.pulse) return <PulseNotFound />
  if (topic.isError) return <PulseNotFound />
  const t = topic.data
  const canStart = me.data.features.pulseEdit
  const quotes = t ? t.quotes.filter((q) => channel === 'all' || q.channel === channel) : []

  return (
    <div className={styles.page}>
      <PageHero title={t?.title ?? 'Topic'} description={t ? `${plural(t.signals, 'kept signal')} from ${plural(t.reach, 'account')}, heard in ${t.channelCount} of ${CHANNELS.length} channels${t.arr !== null ? ` · ${moneyFull(t.arr)} ARR${t.arrUnmatched ? ` (${t.arrUnmatched} of ${t.arrMatched + t.arrUnmatched} accounts not found in Salesforce)` : ''}` : ''}` : 'Loading…'} glow="left" variant="wave">
        {t && (
          <Tag type="purple" size="md">
            Rank #{t.rank} · score {t.score}
          </Tag>
        )}
      </PageHero>

      <Link to="/pulse" className={styles.back} data-testid="topic-back">
        <ArrowLeft size={16} aria-hidden />
        All topics
      </Link>

      {t && (
        <>
          <div className={styles.actions}>
            {canStart && (
              <Button kind="primary" size="md" data-testid="dig-in" onClick={() => setCreating(true)}>
                Dig into this
              </Button>
            )}
            {canStart && (
              <Button kind="tertiary" size="md" data-testid="toggle-pick" onClick={() => toggle(t.id)}>
                {selected.includes(t.id) ? 'Remove from selection' : 'Add to selection'}
              </Button>
            )}
            {canStart && selected.length > (selected.includes(t.id) ? 1 : 0) && (
              <Button kind="ghost" size="md" onClick={() => navigate('/pulse')}>
                Go to the {plural(selected.length, 'selected topic')}
              </Button>
            )}
          </div>

          {t.inPlay && (
            <section className={styles.card} aria-label="What is at stake" data-testid="topic-in-play">
              <h2 className={styles.head}>What is at stake</h2>
              <p className={styles.note}>
                {t.inPlay.open.count > 0
                  ? `Mentioned in ${t.inPlay.open.count} open ${t.inPlay.open.count === 1 ? 'opportunity' : 'opportunities'} worth ${moneyFull(t.inPlay.open.amount)}${t.inPlay.open.closingSoon ? `, ${t.inPlay.open.closingSoon} closing within 90 days` : ''}.`
                  : 'Not mentioned in any open opportunity.'}
                {t.inPlay.lost.count > 0 && ` Also in ${t.inPlay.lost.count} ${t.inPlay.lost.count === 1 ? 'opportunity' : 'opportunities'} lost in the last 90 days, worth ${moneyFull(t.inPlay.lost.amount)}.`}
              </p>
              <p className={styles.note}>An estimate of what is riding on it, from the amounts on the opportunities whose notes raised it. It is not a forecast: a deal amount is not always annual revenue.</p>
            </section>
          )}

          <section className={styles.card} aria-label="In Signal Flow" data-testid="topic-links">
            <h2 className={styles.head}>In Signal Flow</h2>
            {t.researched.length > 0 ? (
              <p className={styles.note}>
                Already researched:{' '}
                {t.researched.map((r, i) => (
                  <span key={r.id}>
                    {i > 0 && ', '}
                    <Link to={`/insights/themes?theme=${r.id}`} data-testid="researched-link">
                      {r.title}
                    </Link>
                  </span>
                ))}
                . Check what was learned before asking again.
              </p>
            ) : (
              <p className={styles.note}>Not researched yet: no theme in Platform Insights covers this.</p>
            )}
            {t.projects.length > 0 && (
              <p className={styles.note}>
                Projects started from it:{' '}
                {t.projects.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ', '}
                    <Link to={`/projects/${p.id}/plan`} data-testid="project-link">
                      {p.name}
                    </Link>
                  </span>
                ))}
                .
              </p>
            )}
          </section>

          <section className={styles.cols}>
            <div className={styles.card} data-testid="topic-accounts">
              <h2 className={styles.head}>Accounts</h2>
              {t.accounts.length ? (
                <ul className={styles.list}>
                  {t.accounts.map((a) => (
                    <li key={a.name}>
                      <span>{a.name}</span>
                      <span className={styles.muted}>
                        {a.arr !== null ? `${moneyFull(a.arr)} ARR · ` : ''}
                        {plural(a.signals, 'signal')}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>No account is named on these signals.</p>
              )}
            </div>
            <div className={styles.card} data-testid="topic-people">
              <h2 className={styles.head}>People who raised it</h2>
              {t.people.length ? (
                <ul className={styles.list}>
                  {t.people.map((p) => (
                    <li key={p.name}>
                      <span>{p.name}</span>
                      <span className={styles.muted}>{plural(p.signals, 'signal')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.muted}>Nobody is named on these signals.</p>
              )}
              <p className={styles.note}>People and accounts here are possible research participants. Add them under Participants once the project exists.</p>
            </div>
            <div className={styles.card} data-testid="topic-why">
              <h2 className={styles.head}>Why it ranks here</h2>
              <p className={styles.muted}>Trend: {TREND[t.trend]}</p>
              <dl className={styles.sum}>
                {t.breakdown.map((b) => (
                  <div key={b.channel} className={styles.sumRow}>
                    <dt>{CHANNEL_LABEL[b.channel]}</dt>
                    <dd>
                      {b.count} × {b.weight} = {b.subtotal}
                    </dd>
                  </div>
                ))}
                <div className={styles.sumTotal}>
                  <dt>Score</dt>
                  <dd>{t.score}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section className={styles.quotes} aria-label="What customers said" data-testid="topic-quotes">
            <div className={styles.quotesHead}>
              <h2 className={styles.head}>What customers said ({quotes.length})</h2>
              <Select id="quote-channel" data-testid="quote-channel" labelText="Channel" size="sm" inline value={channel} onChange={(e) => setChannel(e.target.value as 'all' | PulseChannel)}>
                <SelectItem value="all" text="All channels" />
                {CHANNELS.filter((c) => t.channels[c.key]).map((c) => (
                  <SelectItem key={c.key} value={c.key} text={`${c.label} (${t.channels[c.key]})`} />
                ))}
              </Select>
            </div>
            <ul className={styles.quoteList}>
              {quotes.map((q) => (
                <li key={q.id} className={styles.quote} data-testid="quote">
                  <p className={styles.words}>“{q.body}”</p>
                  <p className={styles.meta}>
                    {[CHANNEL_LABEL[q.channel], q.sourceLabel, q.saidBy, q.account, q.occurredOn].filter(Boolean).join(' · ')}
                    {q.opportunity && <span data-testid="quote-opportunity"> · {oppLine(q.opportunity)}</span>}
                    {q.sourceUrl && (
                      <>
                        {' · '}
                        <a href={q.sourceUrl} target="_blank" rel="noopener noreferrer">
                          Open the source<span className={styles.srOnly}> (opens in a new tab)</span>
                        </a>
                      </>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <CreateProjectPanel topics={[t]} open={creating} onClose={() => setCreating(false)} />
        </>
      )}
    </div>
  )
}
