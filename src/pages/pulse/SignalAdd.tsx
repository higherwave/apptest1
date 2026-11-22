import { useState } from 'react'
import { Button, InlineNotification, Select, SelectItem, TextArea, TextInput } from '@carbon/react'
import { friendlyMessage, type PulseSignal } from '../../api/client'
import { useAddPulseSignal, useImportPulseNotes } from '../../api/hooks'
import { CHANNELS } from './channels'
import { KINDS } from './signalKinds'
import styles from './PulsePage.module.scss'

const DATE = /^\d{4}-\d{2}-\d{2}$/

// The two ways a person puts a signal in: one typed in, which is kept at once, or notes pasted from a call or meeting, which are split into signals that wait to be kept or dismissed.
export function AddSignal() {
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

export function ImportNotes({ onDone }: { onDone?: () => void }) {
  const imp = useImportPulseNotes()
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [channel, setChannel] = useState<PulseSignal['channel']>('call_notes')
  const [account, setAccount] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: number; duplicates: number } | null>(null)
  const run = async () => {
    setResult(null)
    try {
      const r = await imp.mutateAsync({ text, channel, sourceLabel: label, account })
      setResult(r)
      setText('')
      onDone?.()
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
          subtitle={[result.skipped ? `${result.skipped} more were left out: at most 200 are added at a time.` : result.created ? 'They are under To review.' : 'Very short lines are left out.', result.duplicates ? `${result.duplicates} repeated ${result.duplicates === 1 ? 'one was' : 'ones were'} left out.` : ''].filter(Boolean).join(' ')}
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
