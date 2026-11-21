import { useState } from 'react'
import { Button, InlineNotification, Select, SelectItem, TextInput, Tag } from '@carbon/react'
import { friendlyMessage, type PulseSource } from '../../api/client'
import { useAddPulseSource, useCheckPulseSource, usePulseSources, useRemovePulseSource, useUpdatePulseSource } from '../../api/hooks'
import { CHANNELS } from '../pulse/channels'
import styles from './PulseSources.module.scss'

const MODES = [
  { key: 'review', label: 'Wait for review' },
  { key: 'keep', label: 'Count at once' },
] as const

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet')

// Admin, Pulse: the places Pulse may read customer feedback from. Only a channel listed here is ever read.
export function PulseSources() {
  const list = usePulseSources()
  const add = useAddPulseSource()
  const update = useUpdatePulseSource()
  const remove = useRemovePulseSource()
  const check = useCheckPulseSource()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'keep' | 'review'>('review')
  const [note, setNote] = useState<{ id: string; text: string; error: boolean } | null>(null)

  const submit = async () => {
    try {
      await add.mutateAsync({ name, mode })
      setName('')
    } catch {
      /* shown below */
    }
  }
  const run = async (s: PulseSource) => {
    setNote(null)
    try {
      const r = await check.mutateAsync(s.id)
      setNote({ id: s.id, error: !!r.error, text: r.error ?? (r.added ? `${r.added} new ${r.added === 1 ? 'message' : 'messages'} read.` : 'Nothing new.') })
    } catch (err) {
      setNote({ id: s.id, error: true, text: friendlyMessage(err) })
    }
  }
  const sources = list.data?.sources ?? []
  return (
    <section className={styles.card} aria-label="Feedback sources" data-testid="pulse-sources-card">
      <h2 className={styles.head}>Where Pulse listens</h2>
      <p className={styles.text}>
        Pulse reads only the Slack channels you list here, never the rest of Slack. Pick channels set up for customer feedback and pain points. Each is read about once an hour. Messages from bots and joins are left out, and a message is never read twice.
        With "Wait for review", messages wait in the Signals list until someone keeps or dismisses them. With "Count at once" they join the topics at the next update.
      </p>
      {list.data && !list.data.slackConnected && (
        <InlineNotification hideCloseButton lowContrast kind="info" title="Slack is not connected" subtitle="You can list channels now. They are read once Slack is connected with the channel-reading permissions." data-testid="sources-no-slack" />
      )}
      {sources.length === 0 && list.data && <p className={styles.detail}>No sources yet.</p>}
      {sources.map((s) => (
        <div key={s.id} className={styles.source} data-testid={`source-${s.name}`}>
          <div className={styles.top}>
            <span className={styles.name}>{s.kind === 'salesforce_opportunity' ? 'Salesforce opportunity notes' : `#${s.name}`}</span>
            {s.config && (
              <span className={styles.detail}>
                {s.config.fields.join(', ')} · {s.config.scope === 'open' ? 'open' : s.config.scope === 'lost' ? 'lost' : 'open and lost'} opportunities
              </span>
            )}
            {!s.enabled && <Tag size="sm" type="gray">Off</Tag>}
            <span className={styles.detail}>
              Checked {when(s.lastCheckedAt)}
              {s.lastAdded !== null && s.lastError === null ? `, ${s.lastAdded} new` : ''}
            </span>
          </div>
          {s.lastError && <InlineNotification hideCloseButton lowContrast kind="warning" title="Last read failed" subtitle={s.lastError} />}
          <div className={styles.row}>
            <Select id={`source-channel-${s.id}`} data-testid={`source-channel-${s.name}`} size="sm" labelText="Counts as" value={s.channel} onChange={(e) => update.mutate({ id: s.id, patch: { channel: e.target.value as PulseSource['channel'] } })}>
              {CHANNELS.map((c) => (
                <SelectItem key={c.key} value={c.key} text={c.label} />
              ))}
            </Select>
            <Select id={`source-mode-${s.id}`} data-testid={`source-mode-${s.name}`} size="sm" labelText="New messages" value={s.mode} onChange={(e) => update.mutate({ id: s.id, patch: { mode: e.target.value as PulseSource['mode'] } })}>
              {MODES.map((m) => (
                <SelectItem key={m.key} value={m.key} text={m.label} />
              ))}
            </Select>
          </div>
          <div className={styles.actions}>
            <Button kind="tertiary" size="sm" data-testid={`source-check-${s.name}`} disabled={check.isPending} onClick={() => run(s)}>
              {check.isPending && check.variables === s.id ? 'Reading…' : 'Check now'}
            </Button>
            <Button kind="ghost" size="sm" data-testid={`source-toggle-${s.name}`} onClick={() => update.mutate({ id: s.id, patch: { enabled: !s.enabled } })}>
              {s.enabled ? 'Turn off' : 'Turn on'}
            </Button>
            <Button kind="ghost" size="sm" data-testid={`source-remove-${s.name}`} onClick={() => remove.mutate(s.id)}>
              Remove
            </Button>
          </div>
          {note?.id === s.id && <p className={note.error ? styles.problem : styles.detail} role="status" data-testid="source-note">{note.text}</p>}
        </div>
      ))}
      <div className={styles.add}>
        <TextInput id="source-name" data-testid="source-name" labelText="Slack channel" placeholder="customer-feedback" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) void submit() }} />
        <Select id="source-new-mode" data-testid="source-new-mode" labelText="New messages" value={mode} onChange={(e) => setMode(e.target.value as 'keep' | 'review')}>
          {MODES.map((m) => (
            <SelectItem key={m.key} value={m.key} text={m.label} />
          ))}
        </Select>
        <Button kind="primary" size="md" data-testid="source-add" disabled={!name.trim() || add.isPending} onClick={submit}>
          {add.isPending ? 'Adding…' : 'Add channel'}
        </Button>
      </div>
      {add.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not added" subtitle={friendlyMessage(add.error)} data-testid="source-add-error" />}
    </section>
  )
}
