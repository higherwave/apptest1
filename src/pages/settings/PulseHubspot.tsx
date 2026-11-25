import { useState } from 'react'
import { Button, InlineNotification, Modal, Tag, TextInput } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { useAddPulseTicketSource, useCheckPulseHubspot, useConnectPulseHubspot, useDisconnectPulseHubspot, usePulseHubspot, usePulseSources } from '../../api/hooks'
import styles from './PulseSources.module.scss'

// Settings, Pulse: the read-only HubSpot link. Pulse reads the subject, description and category of support tickets, and the company each belongs to, so what customers write to support is
// heard alongside everything else. It never writes to HubSpot, and agent notes, conversations and contact details are never read. An owner connects it here by pasting a HubSpot service key
// that can only read: the app tries the key first, then stores it encrypted, and never shows it again.
export function PulseHubspot() {
  const status = usePulseHubspot()
  const check = useCheckPulseHubspot()
  const connect = useConnectPulseHubspot()
  const disconnect = useDisconnectPulseHubspot()
  const sources = usePulseSources()
  const add = useAddPulseTicketSource()
  const [categories, setCategories] = useState('')
  const [token, setToken] = useState('')
  const [portal, setPortal] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [justConnected, setJustConnected] = useState(false)
  const s = check.data ?? status.data
  const connected = !!s?.connected
  const has = !!sources.data?.sources.some((x) => x.kind === 'hubspot_tickets')
  const list = categories.split(',').map((c) => c.trim()).filter(Boolean)
  const showForm = status.data && (!connected || replacing)

  const save = async () => {
    setJustConnected(false)
    try {
      await connect.mutateAsync({ token, portalId: portal.trim() || null })
      setToken('') // the key is not kept in the page once it is saved
      setPortal('')
      setReplacing(false)
      check.reset()
      setJustConnected(true)
    } catch {
      /* the message is shown below */
    }
  }
  const remove = async () => {
    try {
      await disconnect.mutateAsync()
      setConfirming(false)
      check.reset()
      setJustConnected(false)
    } catch {
      /* the message is shown in the dialog */
    }
  }
  return (
    <section className={styles.card} aria-label="HubSpot" data-testid="pulse-hubspot-card">
      <h2 className={styles.head}>HubSpot support tickets</h2>
      <p className={styles.text}>
        Pulse can read the support tickets in HubSpot, read only: the subject, description and category of each ticket, and the company it belongs to. Agent notes, conversations and contact details are never read, and nothing is ever
        written to HubSpot. Tickets count as their own channel, Support tickets.
      </p>
      {connected && (
        <div className={styles.top}>
          <Tag size="sm" type={s?.error ? 'red' : 'green'}>{s?.error ? 'Problem' : 'Connected'}</Tag>
          {s?.portalId && <span className={styles.detail} data-testid="hubspot-portal">Account {s.portalId}</span>}
          <Button kind="ghost" size="sm" data-testid="hubspot-check" disabled={check.isPending} onClick={() => check.mutate()}>
            {check.isPending ? 'Testing…' : 'Test connection'}
          </Button>
          <Button kind="ghost" size="sm" data-testid="hubspot-replace" onClick={() => setReplacing((r) => !r)}>
            {replacing ? 'Cancel' : 'Replace key'}
          </Button>
          <Button kind="ghost" size="sm" data-testid="hubspot-disconnect" onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
          {check.isSuccess && !s?.error && <span className={styles.detail} data-testid="hubspot-ok">HubSpot answered, and the key can read tickets.</span>}
        </div>
      )}
      {justConnected && <InlineNotification hideCloseButton lowContrast kind="success" title="HubSpot is connected" subtitle="HubSpot accepted the key, and it can read tickets. The key is stored encrypted and is not shown again." data-testid="hubspot-connected" />}
      {s?.error && <InlineNotification hideCloseButton lowContrast kind="warning" title="HubSpot would not answer" subtitle={s.error} data-testid="hubspot-error" />}
      {check.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not tested" subtitle={friendlyMessage(check.error)} />}
      {showForm && (
        <div className={styles.form} data-testid="hubspot-connect-form">
          <p className={styles.detail}>
            In HubSpot, open Development, Keys, Service keys, and create a service key that can only read. It needs at least <b>crm.objects.tickets.read</b> and <b>crm.objects.companies.read</b>. Paste it here. It is tried first, then stored
            encrypted, and never shown again.
          </p>
          <TextInput id="hubspot-key" data-testid="hubspot-key" type="password" autoComplete="new-password" labelText="HubSpot service key" value={token} onChange={(e) => setToken(e.target.value)} />
          <TextInput id="hubspot-portal-id" data-testid="hubspot-portal-id" autoComplete="off" labelText="HubSpot account number (optional)" helperText="The number after /contacts/ in HubSpot's address bar. It only makes each ticket link back to HubSpot." value={portal} onChange={(e) => setPortal(e.target.value)} />
          {connect.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not connected" subtitle={friendlyMessage(connect.error)} data-testid="hubspot-connect-error" />}
          <div>
            <Button kind="primary" size="md" data-testid="hubspot-connect" disabled={!token.trim() || connect.isPending} onClick={save}>
              {connect.isPending ? 'Trying the key…' : replacing ? 'Replace key' : 'Connect HubSpot'}
            </Button>
          </div>
        </div>
      )}
      {connected && !has && (
        <>
          <div className={styles.form}>
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
      <Modal open={confirming} danger modalHeading="Disconnect HubSpot?" primaryButtonText={disconnect.isPending ? 'Disconnecting…' : 'Disconnect'} secondaryButtonText="Cancel" primaryButtonDisabled={disconnect.isPending} onRequestClose={() => setConfirming(false)} onRequestSubmit={remove} data-testid="hubspot-disconnect-modal">
        <p>The stored key is deleted and no new tickets are read. Tickets Pulse has already read stay, and you can connect again at any time.</p>
        {disconnect.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not disconnected" subtitle={friendlyMessage(disconnect.error)} />}
      </Modal>
    </section>
  )
}
