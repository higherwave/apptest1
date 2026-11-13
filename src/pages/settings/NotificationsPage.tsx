import { useMemo } from 'react'
import { Button, Checkbox, ComboBox, InlineNotification } from '@carbon/react'
import { useNotificationPreferences, useSaveNotificationPreferences, useSendReminderNow } from '../../api/hooks'
import { SettingsHeader } from './SettingsHeader'
import styles from './NotificationsPage.module.scss'

const MESSAGE = {
  sent: { kind: 'success', title: 'Reminder sent', subtitle: 'Check your inbox.' },
  nothing_left: { kind: 'info', title: 'Nothing to remind you about', subtitle: 'No project has a step left to do, so there is nothing to send.' },
  not_configured: { kind: 'warning', title: 'Email is not set up here', subtitle: 'This deployment has no email sender configured yet.' },
  failed: { kind: 'error', title: 'The reminder could not be sent', subtitle: 'The email service refused it. Try again in a minute.' },
} as const

// Your own reminder settings: the daily email that lists your projects with a step still to do, each with a link to the next step.
// Owners and editors get it; the page is the same for both.
export function NotificationsPage() {
  const prefs = useNotificationPreferences()
  const save = useSaveNotificationPreferences()
  const test = useSendReminderNow()
  const zones = useMemo(() => (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : []), [])
  const p = prefs.data
  return (
    <div className={styles.page}>
      <SettingsHeader />
      {p && (
        <>
          <section className={styles.card} aria-label="Daily reminder" data-testid="reminder-card">
            <h2 className={styles.head}>Daily reminder</h2>
            <p className={styles.text}>
              Once a day, between 6am and 6pm your time, we email {p.email} when a project of a team you edit in has a step still to do, with a link straight to that step (grouped by team if you edit in more than one). Once a project has said the same thing three days in a row, it stops
              until something changes. Measure is not included yet.
            </p>
            <Checkbox id="reminder-on" data-testid="reminder-on" labelText="Email me this reminder" checked={p.digestEnabled} onChange={(_, { checked }) => save.mutate({ digestEnabled: checked })} />
            <ComboBox
              id="reminder-zone"
              data-testid="reminder-zone"
              titleText="Your time zone"
              helperText={p.timeZone ? undefined : 'Not known yet. Choose one so the reminder arrives at 6am for you.'}
              items={zones}
              itemToString={(z: string | null) => z ?? ''}
              selectedItem={p.timeZone}
              onChange={({ selectedItem }: { selectedItem?: string | null }) => selectedItem && save.mutate({ timeZone: selectedItem })}
              shouldFilterItem={({ item, inputValue }: { item: string; inputValue: string | null }) => !inputValue || item.toLowerCase().includes(inputValue.toLowerCase().replace(/ /g, '_'))}
            />
          </section>
          <section className={styles.card} aria-label="Try it" data-testid="reminder-test-card">
            <h2 className={styles.head}>Try it now</h2>
            <p className={styles.text}>Sends you the reminder right away, whatever the time and whether or not the daily reminder is on. Handy for checking the email or showing it in a demo.</p>
            <div>
              <Button kind="tertiary" size="md" data-testid="reminder-now" disabled={test.isPending || !p.receives} onClick={() => test.mutate()}>
                {test.isPending ? 'Sending…' : 'Send me a reminder now'}
              </Button>
            </div>
            {test.data && <InlineNotification hideCloseButton lowContrast data-testid="reminder-result" data-outcome={test.data.outcome} {...MESSAGE[test.data.outcome]} />}
            {test.data?.error && (
              <p className={styles.detail} data-testid="reminder-error">
                What the email service said: {test.data.error}
              </p>
            )}
            {test.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Something went wrong" subtitle="The request did not go through." />}
          </section>
          {!p.mailConfigured && <InlineNotification hideCloseButton lowContrast kind="warning" title="Email is not set up on this deployment" subtitle="Reminders will not be sent until the mail settings are added." />}
        </>
      )}
    </div>
  )
}
