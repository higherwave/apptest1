import { InlineNotification, Loading, ProgressBar, Tag } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import { useUsage } from '../../api/hooks'
import { SettingsHeader } from './SettingsHeader'
import { formatBytes, LEVEL_LABEL, share } from './usageText'
import styles from './AppStatusPage.module.scss'

// How much of each limit the app has used. Owners only: the Admin gate sends everyone else away, and the server refuses them. Today the database's
// size against the plan's limit; more rows come when the accounts behind the app are on plans worth connecting.
export function UsagePage() {
  const usage = useUsage()
  return (
    <div className={styles.page}>
      <SettingsHeader />
      <p className={styles.text}>How much of each limit the app has used. The figures are read from the app’s own database; nothing here connects to another account.</p>
      {usage.isError && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={friendlyMessage(usage.error)} />}
      {usage.isPending && <Loading small withOverlay={false} description="Loading usage" />}
      {usage.data?.map((row) => (
        <section key={row.key} className={styles.card} aria-label={row.label} data-testid={`usage-${row.key}`}>
          <h2 className={styles.head}>
            {row.label}{' '}
            {row.level !== 'ok' && (
              <Tag size="sm" type={row.level === 'half' ? 'warm-gray' : 'red'}>
                {LEVEL_LABEL[row.level]}
              </Tag>
            )}
          </h2>
          {row.used === null ? (
            <p className={styles.text}>Could not be read right now.</p>
          ) : row.limit ? (
            <ProgressBar
              label={`${row.label} against its limit`}
              hideLabel
              size="small"
              value={Math.min(row.used, row.limit)}
              max={row.limit}
              helperText={`${formatBytes(row.used)} of ${formatBytes(row.limit)} (${share(row.used, row.limit)}%)`}
            />
          ) : (
            <p className={styles.text}>{formatBytes(row.used)} used. No limit is set.</p>
          )}
          <p className={styles.meta}>{row.note}</p>
        </section>
      ))}
    </div>
  )
}
