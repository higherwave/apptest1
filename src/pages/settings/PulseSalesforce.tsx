import { useState } from 'react'
import { Button, InlineNotification, Tag } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { useConnections, useConnectSalesforce, useDisconnect, usePulseSalesforce, useSyncPulseSalesforce } from '../../api/hooks'
import { ConnectForm, DisconnectModal } from './ConnectionParts'
import styles from './PulseSources.module.scss'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet')

// Settings, Pulse: the read-only Salesforce link. Pulse copies each account's name and ARR so topics show the revenue behind the accounts that raised them. It never writes to Salesforce.
// An owner connects it here: the org address, the External Client App's consumer key and secret and the ARR field are tried against Salesforce first, then the secret is stored encrypted and never shown again.
export function PulseSalesforce() {
  const status = usePulseSalesforce()
  const sync = useSyncPulseSalesforce()
  const conns = useConnections()
  const connect = useConnectSalesforce()
  const disconnect = useDisconnect()
  const [replacing, setReplacing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [done, setDone] = useState(false)
  const s = status.data
  const sf = conns.data?.salesforce
  const showForm = !!s && (!s.connected || replacing)
  return (
    <section className={styles.card} aria-label="Salesforce" data-testid="pulse-salesforce-card">
      <h2 className={styles.head}>Salesforce, for ARR</h2>
      <p className={styles.text}>
        Pulse can copy each account's name and annual recurring revenue (ARR) from Salesforce, read only, so topics show the revenue behind the accounts that raised them. A signal's account is matched to a Salesforce account by name,
        ignoring capitals, punctuation and endings like "Inc". Nothing is ever written to Salesforce. Amounts are shown in US dollars.
      </p>
      {done && <InlineNotification hideCloseButton lowContrast kind="success" title="Salesforce is connected" subtitle="Salesforce accepted the sign-in and the ARR field can be read. The secret is stored encrypted and is not shown again. Copy the accounts next." data-testid="connected-salesforce" />}
      {showForm && (
        <ConnectForm
          kind="salesforce"
          intro={<>In Salesforce, create an External Client App with the client credentials flow and a read-only run-as user (the steps are in the setup guide), then paste its details. They are tried first, then the secret is stored encrypted and never shown again.</>}
          fields={[
            { key: 'instanceUrl', label: 'Salesforce address', placeholder: 'yourcompany.my.salesforce.com', helper: 'https:// is added if you leave it out.', initial: sf?.instanceUrl ?? '' },
            { key: 'clientId', label: 'Consumer key', placeholder: '3MVG…' },
            { key: 'clientSecret', label: 'Consumer secret', secret: true },
            { key: 'arrField', label: 'ARR field on Account', placeholder: 'ARR__c', helper: 'The API name of the field. A custom field ends in __c.', initial: sf?.arrField ?? 'ARR__c' },
          ]}
          submitLabel={replacing ? 'Replace connection' : 'Connect Salesforce'}
          pending={connect.isPending}
          error={connect.isError ? connect.error : null}
          onSubmit={async (v) => {
            await connect.mutateAsync({ instanceUrl: v.instanceUrl, clientId: v.clientId, clientSecret: v.clientSecret, arrField: v.arrField })
            setReplacing(false)
            setDone(true)
          }}
        />
      )}
      {s?.connected && (
        <div className={styles.top}>
          <Tag size="sm" type="green">Connected</Tag>
          <span className={styles.detail} data-testid="salesforce-status">
            {s.accounts} {s.accounts === 1 ? 'account' : 'accounts'} copied · last copied {when(s.syncedAt)}
          </span>
        </div>
      )}
      {s?.error && s.connected && <InlineNotification hideCloseButton lowContrast kind="warning" title="Last copy failed" subtitle={s.error} data-testid="salesforce-error" />}
      {sync.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not copied" subtitle={friendlyMessage(sync.error)} />}
      {s?.connected && (
        <div className={styles.actions}>
          <Button kind="tertiary" size="sm" data-testid="salesforce-sync" disabled={sync.isPending} onClick={() => sync.mutate()}>
            {sync.isPending ? 'Copying…' : 'Copy accounts now'}
          </Button>
          <Button kind="ghost" size="sm" data-testid="replace-salesforce" onClick={() => setReplacing((r) => !r)}>
            {replacing ? 'Cancel' : 'Replace secret'}
          </Button>
          <Button kind="ghost" size="sm" data-testid="disconnect-salesforce" onClick={() => setConfirming(true)}>
            Disconnect
          </Button>
          <span className={styles.detail}>Accounts are also copied by themselves about once a day.</span>
        </div>
      )}
      <DisconnectModal kind="salesforce" name="Salesforce" open={confirming} pending={disconnect.isPending} error={disconnect.isError ? disconnect.error : null} extra="The accounts and opportunity notes Pulse already read stay." onClose={() => setConfirming(false)} onConfirm={async () => { try { await disconnect.mutateAsync('salesforce'); setConfirming(false); setDone(false) } catch { /* shown */ } }} />
    </section>
  )
}
