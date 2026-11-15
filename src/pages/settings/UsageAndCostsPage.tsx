import { SettingsHeader } from './SettingsHeader'
import { SettingsTabs } from './SettingsTabs'
import { AiUsage } from './AppStatusPage'
import { SystemUsage } from './UsagePage'
import styles from './SettingsSection.module.scss'

// Admin, Usage and Costs: what the AI is costing this month, and how much of each system limit the app has used. Owners only.
export function UsageAndCostsPage() {
  return (
    <div className={styles.page}>
      <SettingsHeader />
      <SettingsTabs
        label="Usage and costs views"
        tabs={[
          { key: 'ai', label: 'AI', testId: 'tab-ai', content: <AiUsage /> },
          { key: 'system', label: 'System', testId: 'tab-system', content: <SystemUsage /> },
        ]}
      />
    </div>
  )
}
