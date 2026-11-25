import { useState } from 'react'
import { Button, InlineNotification, Tag, TextInput } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { useAddPulseTicketSource, useCheckPulseHubspot, usePulseHubspot, usePulseSources } from '../../api/hooks'
import styles from './PulseSources.module.scss'

// Settings, Pulse: the read-only HubSpot link. Pulse reads the subject, description and category of support tickets, and the company each belongs to, so what customers write to support is
// heard alongside everything else. It never writes to HubSpot, and agent notes, conversations and contact details are never read. The connection itself (a HubSpot service key with read
// scopes) is set up by the operator (see docs/SETUP.md), not typed in here.
export function PulseHubspot() {
  const status = usePulseHubspot()
  const check = useCheckPulseHubspot()
  const sources = usePulseSources()
  const add = useAddPulseTicketSource()
  const [categories, setCategories] = useState('')
  const s = check.data ?? status.data
  const has = !!sources.data?.sources.some((x) => x.kind === 'hubspot_tickets')
  const list = categories.split(',').map((c) => c.trim()).filter(Boolean)
  return (
    <section className={styles.card} aria-label="HubSpot" data-testid="pulse-hubspot-card">
      <h2 className={styles.head}>HubSpot support tickets</h2>
      <p className={styles.text}>
        Pulse can read the support tickets in HubSpot, read only: the subject, description and category of each ticket, and the company it belongs to. Agent notes, conversations and contact details are never read, and nothing is ever
        written to HubSpot. Tickets count as their own channel, Support tickets.
      </p>
      {s && !s.connected && (
        <InlineNotification hideCloseButton lowContrast kind="info" title="HubSpot is not connected" subtitle="Connecting is a one-time setup by whoever runs Signal Flow, with a HubSpot service key that can only read. The steps are in the setup guide (docs/SETUP.md)." data-testid="hubspot-not-connected" />
      )}
      {s?.connected && (
        <div className={styles.top}>
          <Tag size="sm" type={s.error ? 'red' : 'green'}>{s.error ? 'Problem' : 'Connected'}</Tag>
          <Button kind="ghost" size="sm" data-testid="hubspot-check" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? 'Testing…' : 'Test connection'}
          </Button>
          {check.isSuccess && !s.error && <span className={styles.detail} data-testid="hubspot-ok">HubSpot answered, and the key can read tickets.</span>}
        </div>
      )}
      {s?.error && <InlineNotification hideCloseButton lowContrast kind="warning" title="HubSpot would not answer" subtitle={s.error} data-testid="hubspot-error" />}
      {check.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not tested" subtitle={friendlyMessage(check.error)} />}
      {!has && (
        <>
          <div className={styles.add}>
            <TextInput id="ticket-categories" data-testid="ticket-categories" labelText="Only these ticket categories (optional)" helperText="Leave empty to read every ticket. Separate several with commas, as they are written in HubSpot." value={categories} onChange={(e) => setCategories(e.target.value)} />
          </div>
          {add.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not added" subtitle={friendlyMessage(add.error)} data-testid="ticket-add-error" />}
          <div>
            <Button kind="primary" size="md" data-testid="ticket-add" disabled={list.length > 10 || add.isPending} onClick={() => add.mutate({ categories: list })}>
              {add.isPending ? 'Adding…' : 'Read support tickets'}
            </Button>
          </div>
        </>
      )}
      {has && <p className={styles.detail}>Support tickets are read about once an hour. Check them now, switch them off or remove them under Where Pulse listens.</p>}
    </section>
  )
}
