import { Button, InlineNotification, Toggle } from '@carbon/react'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { usePulsePreview, useSetPulsePreview, useSetup } from '../../api/hooks'
import { T } from '../../../shared/terms.mjs'
import styles from './NotificationsPage.module.scss'

// Settings, Apps: which apps of the suite this workspace uses, and the owner setup flow so it can be shown any time. An owner switches Pulse on or off for the whole workspace; while it is off nobody sees it,
// and while it is on owners and editors use it and anyone else sees it only when they were given view access (Settings, Pulse).
export function AppsPage() {
  const pulse = usePulsePreview()
  const set = useSetPulsePreview()
  const setup = useSetup()
  const navigate = useNavigate()
  return (
    <div className={styles.page}>
      <section className={styles.card} aria-label="Pulse" data-testid="app-pulse-card">
        <h2 className={styles.head}>Pulse</h2>
        <p className={styles.text}>
          What customers are telling you. Pulse reads the Slack channels and Salesforce notes you choose, together with call notes you add, finds the patterns and ranks them, so research starts from what customers actually raise. Turning it on
          puts Pulse in the app switcher for owners and editors, and for anyone you give view access to under Pulse in Settings. Turning it off hides it from everyone, and nothing is deleted.
        </p>
        <Toggle
          id="app-pulse"
          data-testid="app-pulse"
          labelText="Use Pulse in this workspace"
          labelA="Off"
          labelB="On"
          toggled={!!pulse.data?.enabled}
          disabled={!pulse.data || set.isPending}
          onToggle={(on: boolean) => set.mutate(on)}
        />
        {(pulse.isError || set.isError) && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(set.error ?? pulse.error)} />}
      </section>
      <section className={styles.card} aria-label="Workspace setup" data-testid="apps-setup-card">
        <h2 className={styles.head}>Workspace setup</h2>
        <p className={styles.text}>
          The guided setup for a new workspace owner: teams and people, {T.approvals}, experience categories, connections, and data and AI. It does not open by itself: owners see a Set up your workspace button in Settings until it is complete. Open it here to walk through it
          {setup.data ? (setup.data.complete ? ' (this workspace is already set up, so every step reads as done).' : ` (${setup.data.done} of ${setup.data.total} done in this workspace).`) : '.'}
        </p>
        <Button kind="tertiary" size="md" data-testid="apps-setup-open" onClick={() => navigate('/setup')}>
          Open workspace setup
        </Button>
      </section>
    </div>
  )
}
