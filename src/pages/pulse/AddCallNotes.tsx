import { useState } from 'react'
import { Button, InlineNotification, TextArea, TextInput } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { useImportPulseNotes } from '../../api/hooks'
import { RightPanel } from '../../components/RightPanel'
import styles from './AddCallNotes.module.scss'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const plural = (n: number, one: string) => `${n} ${n === 1 ? one : one + 's'}`

// Add call notes: the one thing a person puts into Pulse by hand (Slack and Salesforce are read by Pulse itself). A meeting transcript or an ad-hoc note; each paragraph (or line) becomes a signal
// that counts at once, and the topics pick it up at the next update.
export function AddCallNotes({ open, onClose }: { open: boolean; onClose: () => void }) {
  const imp = useImportPulseNotes()
  const [text, setText] = useState('')
  const [label, setLabel] = useState('')
  const [account, setAccount] = useState('')
  const [saidBy, setSaidBy] = useState('')
  const [date, setDate] = useState('')
  const [url, setUrl] = useState('')
  const [result, setResult] = useState<{ created: number; skipped: number; duplicates: number } | null>(null)
  const dateBad = date !== '' && !DATE.test(date)
  const urlBad = url.trim() !== '' && !/^https?:\/\//i.test(url.trim())
  const close = () => {
    setResult(null)
    imp.reset()
    onClose()
  }
  const run = async () => {
    setResult(null)
    try {
      const r = await imp.mutateAsync({ text, sourceLabel: label, account, saidBy, sourceUrl: url, occurredOn: date || null })
      setResult(r)
      if (r.created) {
        setText('')
        setLabel('')
        setAccount('')
        setSaidBy('')
        setDate('')
        setUrl('')
      }
    } catch {
      /* the message is shown below */
    }
  }
  return (
    <RightPanel open={open} heading="Add call notes" label="Pulse" onClose={close}>
      <div className={styles.form} data-testid="pulse-import">
        <p className={styles.text}>Paste a transcript from a customer meeting, or type an ad-hoc note. Each paragraph (or line) becomes a signal. Slack and Salesforce are read by Pulse itself.</p>
        <TextArea id="notes-text" data-testid="notes-text" labelText="Notes" rows={8} value={text} onChange={(e) => setText(e.target.value)} />
        <TextInput id="notes-label" labelText="What the notes are" placeholder="Renewal call with Northwind" value={label} onChange={(e) => setLabel(e.target.value)} />
        <div className={styles.row}>
          <TextInput id="notes-account" labelText="Account" value={account} onChange={(e) => setAccount(e.target.value)} />
          <TextInput id="notes-date" labelText="Date" placeholder="2026-11-20" invalid={dateBad} invalidText="Use a date like 2026-11-20." value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <TextInput id="notes-said-by" labelText="Who said it (if one person)" value={saidBy} onChange={(e) => setSaidBy(e.target.value)} />
        <TextInput id="notes-url" labelText="Link to the transcript or recording" placeholder="https://" invalid={urlBad} invalidText="A link must start with http:// or https://." value={url} onChange={(e) => setUrl(e.target.value)} />
        {imp.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not added" subtitle={friendlyMessage(imp.error)} />}
        {result && (
          <InlineNotification
            hideCloseButton
            lowContrast
            kind={result.created ? 'success' : 'info'}
            title={result.created ? `${plural(result.created, 'signal')} added` : 'No signals found'}
            subtitle={[
              result.created ? 'They count at once, and topics pick them up at the next update.' : 'Very short lines are left out.',
              result.skipped ? `${plural(result.skipped, 'more paragraph')} were left out: at most 200 are added at a time.` : '',
              result.duplicates ? `${plural(result.duplicates, 'paragraph')} repeated what Pulse already has.` : '',
            ].filter(Boolean).join(' ')}
            data-testid="notes-result"
          />
        )}
        <div className={styles.actions}>
          <Button kind="primary" size="md" data-testid="notes-save" disabled={!text.trim() || dateBad || urlBad || imp.isPending} onClick={run}>
            {imp.isPending ? 'Adding…' : 'Add notes'}
          </Button>
          <Button kind="ghost" size="md" onClick={close}>
            Close
          </Button>
        </div>
      </div>
    </RightPanel>
  )
}
