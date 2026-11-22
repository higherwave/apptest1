import { useState } from 'react'
import { Tab, TabList, TabPanel, TabPanels, Tabs, Tag } from '@carbon/react'
import { useSearchParams } from 'react-router-dom'
import type { PulseStatus, SignalOrigin } from '../../api/client'
import { useMe, usePulseSignals } from '../../api/hooks'
import { PageHero } from '../../shell/PageHero'
import { PulseNotFound } from './PulseNotFound'
import { AddSignal, ImportNotes } from './SignalAdd'
import { SignalReview } from './SignalReview'
import { SignalTopics } from './SignalTopics'
import styles from './PulsePage.module.scss'

const VIEWS: { key: SignalOrigin; label: string; blurb: string }[] = [
  { key: 'auto', label: 'Auto-discovered', blurb: 'What Pulse finds by itself: the Slack channels and Salesforce opportunity notes you set up in Admin.' },
  { key: 'manual', label: 'Manual', blurb: 'What you put in: notes pasted from a customer call or meeting, and single signals typed in.' },
]

// Signals (preview): what customers are saying, by where it came from. Two views: Auto-discovered (found by Pulse) and Manual (put in by a person, where call notes are added). Each shows its topics
// with the accounts and quotes behind them and a way to start a Signal Flow project from the ones picked, and below them the individual signals waiting to be kept or dismissed.
export function PulsePage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  // Which signals the review list shows: after notes are pasted in it goes back to the ones waiting for review.
  const [filter, setFilter] = useState<PulseStatus>('new')
  const auto = usePulseSignals(undefined, 'auto').data?.counts
  const manual = usePulseSignals(undefined, 'manual').data?.counts
  if (!me.data) return null
  // Anyone Pulse is not for sees the page that does not exist: the server answers 404 to them too.
  if (!me.data.features.pulse) return <PulseNotFound />
  const canEdit = !!me.data.features.pulseEdit
  // With no view asked for, the one with signals waiting for review opens first (Auto-discovered otherwise).
  const asked = VIEWS.findIndex((v) => v.key === params.get('tab'))
  const index = asked >= 0 ? asked : canEdit && (manual?.new ?? 0) > 0 && (auto?.new ?? 0) === 0 ? 1 : 0
  const waiting = (c?: { new: number }) => (canEdit && c && c.new > 0 ? c.new : 0)
  const counts = { auto: waiting(auto), manual: waiting(manual) }

  return (
    <div className={styles.page}>
      <PageHero title="Signals" description="What customers are telling you, by where it came from, grouped into topics you can start a project from" glow="left">
        <Tag type="purple" size="md" data-testid="pulse-preview-tag">
          Preview
        </Tag>
      </PageHero>

      <Tabs selectedIndex={index} onChange={({ selectedIndex }) => setParams({ tab: VIEWS[selectedIndex].key }, { replace: true })}>
        <TabList aria-label="Signals views">
          {VIEWS.map((v) => (
            <Tab key={v.key} data-testid={`signals-tab-${v.key}`}>
              {v.label}
              {counts[v.key] > 0 ? ` · ${counts[v.key]} to review` : ''}
            </Tab>
          ))}
        </TabList>
        <TabPanels>
          {VIEWS.map((v, i) => (
            <TabPanel key={v.key} className={styles.panel}>
              {i === index && (
                <div className={styles.view} data-testid={`signals-view-${v.key}`}>
                  <p className={styles.blurb}>{v.blurb}</p>
                  {v.key === 'manual' && canEdit && (
                    <div className={styles.forms}>
                      <ImportNotes onDone={() => setFilter('new')} />
                      <AddSignal />
                    </div>
                  )}
                  <SignalTopics origin={v.key} canEdit={canEdit} />
                  <SignalReview origin={v.key} canEdit={canEdit} filter={filter} onFilter={setFilter} />
                </div>
              )}
            </TabPanel>
          ))}
        </TabPanels>
      </Tabs>
    </div>
  )
}
