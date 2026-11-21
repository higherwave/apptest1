import { Checkbox, InlineNotification, Tag } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { usePulseViewers, useSetPulseViewer } from '../../api/hooks'
import styles from './PulseSources.module.scss'

// Admin, Pulse: who may VIEW Pulse. Owners and editors always can (and editors can change things); anyone else is given view one person at a time, for department leaders in sales,
// customer success, sales ops, product and design. A grant only lets them see: they cannot add, keep, dismiss, regroup or start projects.
export function PulseViewers() {
  const list = usePulseViewers()
  const set = useSetPulseViewer()
  const members = list.data?.members ?? []
  return (
    <section className={styles.card} aria-label="Who can view Pulse" data-testid="pulse-viewers-card">
      <h2 className={styles.head}>Who can view Pulse</h2>
      <p className={styles.text}>
        Owners and editors can always see Pulse, and editors can change it. Other people see it only when you give them view access here, for example department leaders in sales, customer success, sales ops, product and design. View access
        never lets someone change anything.
      </p>
      {list.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Could not load people" subtitle={friendlyMessage(list.error)} />}
      {set.isError && <InlineNotification hideCloseButton lowContrast kind="error" title="Not saved" subtitle={friendlyMessage(set.error)} />}
      <ul className={styles.people} data-testid="pulse-viewers">
        {members.map((m) => (
          <li key={m.userId} className={styles.person} data-testid={`viewer-${m.email}`}>
            {m.always ? (
              <>
                <span className={styles.name}>{m.displayName || m.email}</span>
                <span className={styles.detail}>{m.email}</span>
                <Tag size="sm" type="gray">
                  {m.role === 'owner' ? 'Owner: always' : 'Editor: always'}
                </Tag>
              </>
            ) : (
              <>
                <Checkbox id={`viewer-${m.userId}`} data-testid={`viewer-check-${m.email}`} labelText={`${m.displayName || m.email} (${m.email})`} checked={m.canView} disabled={set.isPending} onChange={(_e, { checked }) => set.mutate({ userId: m.userId, canView: checked })} />
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
