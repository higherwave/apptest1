import { useState } from 'react'
import { Button, InlineNotification, Select, SelectItem, Tag, TextArea, TextInput } from '@carbon/react'
import { friendlyMessage, type PulseSignal, type PulseStatus } from '../../api/client'
import { useAddPulseSignal, useImportPulseNotes, useMe, usePulseSignals, useUpdatePulseSignal } from '../../api/hooks'
import { PageHero } from '../../shell/PageHero'
import { CHANNEL_LABEL, CHANNELS } from './channels'
import { PulseNotFound } from './PulseNotFound'
import switchStyles from '../insights/InsightsHeader.module.scss'
import { oppLine } from './money'
import styles from './PulsePage.module.scss'

const KINDS: { key: PulseSignal['kind']; label: string }[] = [
  { key: 'complaint', label: 'Complaint' },
  { key: 'request', label: 'Request' },
  { key: 'praise', label: 'Praise' },
  { key: 'question', label: 'Question' },
  { key: 'other', label: 'Other' },
]
const KIND_TAG: Record<PulseSignal['kind'], 'red' | 'blue' | 'green' | 'purple' | 'gray'> = { complaint: 'red', request: 'blue', praise: 'green', question: 'purple', other: 'gray' }
const FILTERS: { key: PulseStatus; label: string }[] = [
  { key: 'new', label: 'To review' },
  { key: 'kept', label: 'Kept' },
  { key: 'dismissed', label: 'Dismissed' },
]
const DATE = /^\d{4}-\d{2}-\d{2}$/

// Pulse (preview): what customers are saying, gathered in one place before anyone decides what to research. Owners only, and only while the preview is on (Admin, Previews).
// A signal is one quote, request or complaint. One typed in is kept at once; ones split out of notes wait here to be kept or dismissed.
export function PulsePage() {
  const me = useMe()
  const [filter, setFilter] = useState<PulseStatus>('new')
  const list = usePulseSignals(filter)
  const counts = usePulseSignals().data?.counts
  const update = useUpdatePulseSignal()

  if (!me.data) return null
  // Anyone Pulse is not for sees the page that does not exist: the server answers 404 to them too.
  if (!me.data.features.pulse) return <PulseNotFound />

  return (
    <div className={styles.page}>
      <PageHero title="Pulse" description="What customers are telling you, gathered in one place before you decide what to research" glow="left">
        <Tag type="purple" size="md" data-testid="pulse-preview-tag">
          Preview · owners only
        </Tag>
      </PageHero>
        <nav className={switchStyles.switch} aria-label="Signals">
          {FILTERS.map((f) => (
            <Button key={f.key} kind={f.key === filter ? 'primary' : 'ghost'} size="sm" data-testid={`pulse-filter-${f.key}`} data-current={f.key === filter} aria-current={f.key === filter ? 'true' : undefined} onClick={() => setFilter(f.key)}>
              {f.label}
              {counts ? ` · ${counts[f.key]}` : ''}
            </Button>
          ))}
        </nav>

        {list.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Signals could not be loaded" subtitle={friendlyMessage(list.error)} />}
        {update.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(update.error)} />}

        <ul className={styles.list} aria-label={`${FILTERS.find((f) => f.key === filter)?.label} signals`} data-testid="pulse-list">
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
            </li>
          ))}
        </ul>
        {list.data && !list.data.signals.length && (
          <p className={styles.empty} data-testid="pulse-empty">
            {filter === 'new' ? 'Nothing waiting for review. Add a signal below, or paste notes from a customer call.' : filter === 'kept' ? 'No kept signals yet.' : 'Nothing dismissed.'}
          </p>
        )}

        <AddSignal />
        <ImportNotes onDone={() => setFilter('new')} />
    </div>
  )
}

function AddSignal() {
  const add = useAddPulseSignal()
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<PulseSignal['kind']>('other')
  const [channel, setChannel] = useState<PulseSignal['channel']>('call_notes')
  const [saidBy, setSaidBy] = useState('')
  const [account, setAccount] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [date, setDate] = useState('')
  const [done, setDone] = useState(false)
  const dateBad = date !== '' && !DATE.test(date)
  const save = async () => {
    setDone(false)
    try {
      await add.mutateAsync({ body, kind, channel, saidBy, account, sourceLabel, sourceUrl, occurredOn: date || null })
      setBody(''); setKind('other'); setSaidBy(''); setAccount(''); setSourceLabel(''); setSourceUrl(''); setDate('')
      setDone(true)
    } catch {
      /* the message is shown below */
    }
  }
  return (
    <section className={styles.card} aria-label="Add a signal" data-testid="pulse-add">
      <h2 className={styles.head}>Add a signal</h2>
      <p className={styles.text}>One thing a customer said, asked for or complained about, in their words. It is kept straight away.</p>
      <TextArea id="signal-body" data-testid="signal-body" labelText="What was said" rows={3} maxCount={4000} value={body} onChange={(e) => setBody(e.target.value)} />
      <div className={styles.row}>
        <Select id="signal-kind" data-testid="signal-kind" labelText="Kind" value={kind} onChange={(e) => setKind(e.target.value as PulseSignal['kind'])}>
          {KINDS.map((k) => (
            <SelectItem key={k.key} value={k.key} text={k.label} />
          ))}
        </Select>
        <Select id="signal-channel" data-testid="signal-channel" labelText="Channel" value={channel} onChange={(e) => setChannel(e.target.value as PulseSignal['channel'])}>
          {CHANNELS.map((c) => (
            <SelectItem key={c.key} value={c.key} text={c.label} />
          ))}
        </Select>
        <TextInput id="signal-date" labelText="Date" placeholder="2026-11-20" invalid={dateBad} invalidText="Use a date like 2026-11-20." value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className={styles.row}>
        <TextInput id="signal-said-by" labelText="Who said it" value={saidBy} onChange={(e) => setSaidBy(e.target.value)} />
        <TextInput id="signal-account" labelText="Account" value={account} onChange={(e) => setAccount(e.target.value)} />
        <TextInput id="signal-source" labelText="Where it came from" placeholder="Renewal call, customer meeting" value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
      </div>
      <TextInput id="signal-url" labelText="Link to the source" placeholder="https://" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
      {add.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(add.error)} />}
      {done && <InlineNotification hideCloseButton lowContrast kind="success" title="Signal added" subtitle="It is under Kept." data-testid="signal-added" />}
      <div>
        <Button kind="primary" size="md" data-testid="signal-save" disabled={!body.trim() || dateBad || add.isPending} onClick={save}>
          {add.isPending ? 'Adding…' : 'Add signal'}
        </Button>
      </div>
    </section>
  )
}

function ImportNotes({ onDone }: { onDone: () => void }) {
  const imp = useImportPulseNotes()
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [channel, setChannel] = useState<PulseSignal['channel']>('call_notes')
  const [account, setAccount] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const run = async () => {
    setResult(null)
    try {
      const r = await imp.mutateAsync({ text, channel, sourceLabel: label, account })
      setResult(r)
      setText('')
      onDone()
    } catch {
      /* the message is shown below */
    }
  }
  return (
    <section className={styles.card} aria-label="Add notes" data-testid="pulse-import">
      <h2 className={styles.head}>Add notes</h2>
      <p className={styles.text}>Paste notes from a call or a meeting. Each paragraph (or line) becomes a signal that waits for you to keep or dismiss it.</p>
      <TextArea id="notes-text" data-testid="notes-text" labelText="Notes" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      <div className={styles.row}>
        <Select id="notes-channel" data-testid="notes-channel" labelText="Channel" value={channel} onChange={(e) => setChannel(e.target.value as PulseSignal['channel'])}>
          {CHANNELS.map((c) => (
            <SelectItem key={c.key} value={c.key} text={c.label} />
          ))}
        </Select>
        <TextInput id="notes-label" labelText="What the notes are" placeholder="Renewal call with Northwind" value={label} onChange={(e) => setLabel(e.target.value)} />
        <TextInput id="notes-account" labelText="Account" value={account} onChange={(e) => setAccount(e.target.value)} />
      </div>
      {imp.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not added" subtitle={friendlyMessage(imp.error)} />}
      {result && (
        <InlineNotification
          hideCloseButton
          lowContrast
          kind={result.created ? 'success' : 'info'}
          title={result.created ? `${result.created} ${result.created === 1 ? 'signal' : 'signals'} added for review` : 'No signals found'}
          subtitle={result.skipped ? `${result.skipped} more were left out: at most 200 are added at a time.` : result.created ? 'They are under To review.' : 'Very short lines are left out.'}
          data-testid="notes-result"
        />
      )}
      <div>
        <Button kind="primary" size="md" data-testid="notes-save" disabled={!text.trim() || imp.isPending} onClick={run}>
          {imp.isPending ? 'Adding…' : 'Add notes'}
        </Button>
      </div>
    </section>
  )
}
