import { Button, InlineNotification, Tag } from '@carbon/react'
import { friendlyMessage, type PulseStatus, type SignalOrigin } from '../../api/client'
import { usePulseSignals, useUpdatePulseSignal } from '../../api/hooks'
import { CHANNEL_LABEL } from './channels'
import { oppLine } from './money'
import { KIND_TAG, KINDS } from './signalKinds'
import switchStyles from '../insights/InsightsHeader.module.scss'
import styles from './PulsePage.module.scss'

const FILTERS: { key: PulseStatus; label: string }[] = [
  { key: 'new', label: 'To review' },
  { key: 'kept', label: 'Kept' },
  { key: 'dismissed', label: 'Dismissed' },
]

// The individual signals of one view (found by Pulse, or put in by a person): the ones waiting to be kept or dismissed first, with Kept and Dismissed a click away. Someone who may only
// view sees the kept ones, with no buttons.
export function SignalReview({ origin, canEdit, filter, onFilter }: { origin: SignalOrigin; canEdit: boolean; filter: PulseStatus; onFilter: (f: PulseStatus) => void }) {
  const active: PulseStatus = canEdit ? filter : 'kept'
  const list = usePulseSignals(active, origin)
  const counts = usePulseSignals(undefined, origin).data?.counts
  const update = useUpdatePulseSignal()
  const label = FILTERS.find((f) => f.key === active)?.label ?? ''
  return (
    <section className={styles.review} aria-label="Signals" data-testid={`review-${origin}`}>
      <div className={styles.reviewHead}>
        <h2 className={styles.sectionTitle}>Signals{counts && canEdit && counts.new > 0 ? ` · ${counts.new} to review` : ''}</h2>
        {canEdit && (
          <nav className={switchStyles.switch} aria-label="Signals">
            {FILTERS.map((f) => (
              <Button key={f.key} kind={f.key === filter ? 'primary' : 'ghost'} size="sm" data-testid={`pulse-filter-${f.key}`} data-current={f.key === filter} aria-current={f.key === filter ? 'true' : undefined} onClick={() => onFilter(f.key)}>
                {f.label}
                {counts ? ` · ${counts[f.key]}` : ''}
              </Button>
            ))}
          </nav>
        )}
      </div>

      {list.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Signals could not be loaded" subtitle={friendlyMessage(list.error)} />}
      {update.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(update.error)} />}

      <ul className={styles.list} aria-label={`${label} signals`} data-testid="pulse-list">
        {list.data?.signals.map((s) => (
          <li key={s.id} className={styles.signal} data-testid={`signal-${s.id}`} data-status={s.status}>
            <p className={styles.quote}>{s.body}</p>
            <div className={styles.meta}>
              <Tag type={KIND_TAG[s.kind]} size="sm">
                {KINDS.find((k) => k.key === s.kind)?.label}
              </Tag>
              <span>{[CHANNEL_LABEL[s.channel], s.sourceLabel, s.saidBy, s.account, s.occurredOn].filter(Boolean).join(' · ')}</span>
              {s.opportunity && <span data-testid="signal-opportunity">{oppLine(s.opportunity)}</span>}
              {s.sourceUrl && (
                <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer">
                  Open the source<span className={styles.srOnly}> (opens in a new tab)</span>
                </a>
              )}
            </div>
            {canEdit && (
              <div className={styles.actions}>
                {s.status !== 'kept' && (
                  <Button kind="tertiary" size="sm" data-testid={`keep-${s.id}`} disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: 'kept' })}>
                    Keep
                  </Button>
                )}
                {s.status !== 'dismissed' && (
                  <Button kind="ghost" size="sm" data-testid={`dismiss-${s.id}`} disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: 'dismissed' })}>
                    Dismiss
                  </Button>
                )}
                {s.status === 'dismissed' && (
                  <Button kind="ghost" size="sm" data-testid={`restore-${s.id}`} disabled={update.isPending} onClick={() => update.mutate({ id: s.id, status: 'new' })}>
                    Put back to review
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
      {list.data && !list.data.signals.length && (
        <p className={styles.empty} data-testid="pulse-empty">
          {active === 'new' ? (origin === 'manual' ? 'Nothing waiting for review. Add notes or a signal above.' : 'Nothing waiting for review. Messages and opportunity notes Pulse finds will appear here when their source asks for review.') : active === 'kept' ? 'No kept signals yet.' : 'Nothing dismissed.'}
        </p>
      )}
    </section>
  )
}
