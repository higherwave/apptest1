import { Button, InlineNotification } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { usePulseTopics, useUpdatePulseTopics } from '../../api/hooks'
import styles from './PulseSources.module.scss'

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : null)

// Settings, Pulse: bring the topics up to date now. When scheduled updates are on, Pulse also does this by itself every hour (new kept signals join their topics and the ranking is worked out again, with a full
// regrouping about once a day); while they are paused (PULSE_SCHEDULED_UPDATES), this button is the only way.
export function PulseTopicsUpdate() {
  const topics = usePulseTopics()
  const update = useUpdatePulseTopics()
  const updatedAt = topics.data?.updatedAt ?? null
  return (
    <section className={styles.card} aria-label="Update topics" data-testid="pulse-update-card">
      <h2 className={styles.head}>Update topics</h2>
      <p className={styles.text}>
        {topics.data?.scheduledUpdates
          ? 'Pulse brings the topics up to date by itself every hour: new kept signals join their topics and the ranking is worked out again. Update them now to see a change at once, for example after keeping signals or changing a weight.'
          : 'Topics change only when you update them here: new signals join the topic they fit and the ranking is worked out again. Automatic updates are switched off for now, so nothing changes by itself.'}
        {updatedAt ? ` Last updated ${when(updatedAt)}.` : ' Topics have not been updated yet.'}
      </p>
      {update.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Topics were not updated" subtitle={friendlyMessage(update.error)} />}
      {update.isSuccess && !update.isPending && <InlineNotification hideCloseButton lowContrast kind="success" title="Topics updated" subtitle="The Topics page shows the new ranking." data-testid="topics-updated" />}
      <div>
        <Button kind="tertiary" size="md" data-testid="topics-update" disabled={update.isPending} onClick={() => update.mutate('attach')}>
          {update.isPending ? 'Updating…' : 'Update topics'}
        </Button>
      </div>
    </section>
  )
}
