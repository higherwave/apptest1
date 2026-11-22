import { Button, InlineNotification, Toggle } from '@carbon/react'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { usePulsePreview, useSetPulsePreview, useSetup } from '../../api/hooks'
import { T } from '../../../shared/terms.mjs'
import styles from './NotificationsPage.module.scss'

// Features still being built, and the owner setup flow so it can be shown any time. An owner switches each on or off for the workspace; while one is off nobody sees it, and while it is on only owners do.
export function PreviewsPage() {
  const preview = usePulsePreview()
  const set = useSetPulsePreview()
  const setup = useSetup()
  const navigate = useNavigate()
  return (
    <div className={styles.page}>
      <section className={styles.card} aria-label="Pulse preview" data-testid="preview-pulse-card">
        <h2 className={styles.head}>Pulse</h2>
        <p className={styles.text}>
          Customer signals gathered by hand or from a connected channel, to frame the right questions before research starts. It is a preview: while it is on, only owners see Pulse in the menu, and everyone else sees nothing at all. Turn it off before showing the app to
          anyone you do not want to see it.
        </p>
        <Toggle
          id="preview-pulse"
          data-testid="preview-pulse"
          labelText="Show Pulse (preview)"
          labelA="Off"
          labelB="On"
          toggled={!!preview.data?.enabled}
          disabled={!preview.data || set.isPending}
          onToggle={(on: boolean) => set.mutate(on)}
        />
        {(preview.isError || set.isError) && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(set.error ?? preview.error)} />}
      </section>
      <section className={styles.card} aria-label="Workspace setup preview" data-testid="preview-setup-card">
        <h2 className={styles.head}>Workspace setup</h2>
        <p className={styles.text}>
          The guided setup for a new workspace owner: teams and people, {T.approvals}, experience categories, connections, and data and AI. It does not open by itself: owners see a Set up your workspace button in Settings until it is complete. Open it here to walk through it
          {setup.data ? (setup.data.complete ? ' (this workspace is already set up, so every step reads as done).' : ` (${setup.data.done} of ${setup.data.total} done in this workspace).`) : '.'}
        </p>
        <Button kind="tertiary" size="md" data-testid="preview-setup-open" onClick={() => navigate('/setup')}>
          Open workspace setup
        </Button>
      </section>
    </div>
  )
}
