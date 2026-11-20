import { InlineNotification, Toggle } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { usePulsePreview, useSetPulsePreview } from '../../api/hooks'
import { SettingsHeader } from './SettingsHeader'
import styles from './NotificationsPage.module.scss'

// Features still being built. An owner switches each on or off for the workspace; while one is off nobody sees it, and while it is on only owners do.
export function PreviewsPage() {
  const preview = usePulsePreview()
  const set = useSetPulsePreview()
  return (
    <div className={styles.page}>
      <SettingsHeader />
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
    </div>
  )
}
