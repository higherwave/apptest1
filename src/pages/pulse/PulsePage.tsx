import { useState } from 'react'
import { Button, ContentSwitcher, Switch, Tag } from '@carbon/react'
import { useSearchParams } from 'react-router-dom'
import type { PulseStatus, SignalOrigin } from '../../api/client'
import { useMe, usePulseSignals } from '../../api/hooks'
import { PageHero } from '../../shell/PageHero'
import { PulseNotFound } from './PulseNotFound'
import { AddSignal, ImportNotes } from './SignalAdd'
import { SignalReview } from './SignalReview'
import { SignalTopics } from './SignalTopics'
import styles from './PulsePage.module.scss'

type Source = SignalOrigin | 'all'
const SOURCES: { key: Source; label: string }[] = [
  { key: 'auto', label: 'Auto-discovered' },
  { key: 'manual', label: 'Manual' },
  { key: 'all', label: 'All' },
]

// Signals (preview): what customers are saying, grouped into topics, with the accounts and quotes behind them. One list, with a filter on where it came from: Auto-discovered (found by Pulse, from the Slack
// channels and Salesforce opportunity notes set up in Settings; the page opens on this), Manual (put in by a person) or All. Editors add call notes and single signals from the button at the top, and start a
// Signal Flow project from the topics they pick. Below the topics are the individual signals waiting to be kept or dismissed.
export function PulsePage() {
  const me = useMe()
  const [params, setParams] = useSearchParams()
  // Which signals the review list shows: after notes are pasted in it goes back to the ones waiting for review.
  const [filter, setFilter] = useState<PulseStatus>('new')
  const [adding, setAdding] = useState(false)
  const auto = usePulseSignals(undefined, 'auto').data?.counts
  const manual = usePulseSignals(undefined, 'manual').data?.counts
  if (!me.data) return null
  // Anyone Pulse is not for sees the page that does not exist: the server answers 404 to them too.
  if (!me.data.features.pulse) return <PulseNotFound />
  const canEdit = !!me.data.features.pulseEdit
  const asked = SOURCES.findIndex((s) => s.key === params.get('source'))
  const index = asked >= 0 ? asked : 0
  const source = SOURCES[index].key
  const origin = source === 'all' ? undefined : source
  const waiting = (c?: { new: number }) => (canEdit && c && c.new > 0 ? ` · ${c.new} to review` : '')
  const labels: Record<Source, string> = { auto: `Auto-discovered${waiting(auto)}`, manual: `Manual${waiting(manual)}`, all: `All${waiting(auto && manual ? { new: auto.new + manual.new } : undefined)}` }

  return (
    <div className={styles.page}>
      <PageHero title="Signals" description="What customers are telling you, grouped into topics you can start a project from" glow="left" variant="wave" graphic="pulse">
        <Tag type="purple" size="md" data-testid="pulse-preview-tag">
          Preview
        </Tag>
      </PageHero>

      <div className={styles.filterRow}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Show</span>
          <ContentSwitcher size="sm" selectedIndex={index} onChange={(e) => setParams({ source: e.name as string }, { replace: true })} className={styles.filter}>
            {SOURCES.map((s) => (
              <Switch key={s.key} name={s.key} text={labels[s.key]} data-testid={`signals-filter-${s.key}`} />
            ))}
          </ContentSwitcher>
        </div>
        {canEdit && (
          <Button kind={adding ? 'secondary' : 'tertiary'} size="sm" data-testid="add-notes-toggle" aria-expanded={adding} onClick={() => setAdding((a) => !a)}>
            {adding ? 'Close' : 'Add call notes or a signal'}
          </Button>
        )}
      </div>
      <p className={styles.blurb}>
        {source === 'auto' && 'What Pulse finds by itself: the Slack channels and Salesforce opportunity notes you set up in Settings.'}
        {source === 'manual' && 'What you put in: notes pasted from a customer call or meeting, and single signals typed in.'}
        {source === 'all' && 'Everything, from every source: what Pulse finds by itself and what you put in.'}
      </p>

      <div className={styles.view} data-testid={`signals-view-${source}`}>
        {canEdit && adding && (
          <div className={styles.forms} data-testid="signals-forms">
            <ImportNotes onDone={() => setFilter('new')} />
            <AddSignal />
          </div>
        )}
        <SignalTopics origin={origin} canEdit={canEdit} />
        <SignalReview origin={origin} canEdit={canEdit} filter={filter} onFilter={setFilter} />
      </div>
    </div>
  )
}
