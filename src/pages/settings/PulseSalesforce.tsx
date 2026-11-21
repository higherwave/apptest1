import { Button, InlineNotification, Tag } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { usePulseSalesforce, useSyncPulseSalesforce } from '../../api/hooks'
import styles from './PulseSources.module.scss'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet')

// Admin, Pulse: the read-only Salesforce link. Pulse copies each account's name and ARR so topics show the revenue behind the accounts that raised them. It never writes to Salesforce.
// The connection itself is set up by the operator (see docs/SETUP.md), not typed in here.
export function PulseSalesforce() {
  const status = usePulseSalesforce()
  const sync = useSyncPulseSalesforce()
  const s = status.data
  return (
    <section className={styles.card} aria-label="Salesforce" data-testid="pulse-salesforce-card">
      <h2 className={styles.head}>Salesforce, for ARR</h2>
      <p className={styles.text}>
        Pulse can copy each account's name and annual recurring revenue (ARR) from Salesforce, read only, so topics show the revenue behind the accounts that raised them. A signal's account is matched to a Salesforce account by name,
        ignoring capitals, punctuation and endings like "Inc". Nothing is ever written to Salesforce. Amounts are shown in US dollars.
      </p>
      {s && !s.connected && (
        <InlineNotification hideCloseButton lowContrast kind="info" title="Salesforce is not connected" subtitle="Connecting is a one-time setup by whoever runs Signal Flow. The steps are in the setup guide." data-testid="salesforce-not-connected" />
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
          <span className={styles.detail}>Accounts are also copied by themselves about once a day.</span>
        </div>
      )}
    </section>
  )
}
