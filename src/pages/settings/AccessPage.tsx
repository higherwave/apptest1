import { ApprovalsPage } from '../approvals/ApprovalsPage'
import { PeoplePage } from '../people/PeoplePage'
import { TeamsPage } from '../teams/TeamsPage'
import { SettingsHeader } from './SettingsHeader'
import { SettingsTabs } from './SettingsTabs'
import styles from './SettingsSection.module.scss'

// Admin, User Access: who is in the workspace (People), how they are grouped (Teams) and who approves each launch step (Approvals). Owners only.
export function AccessPage() {
  return (
    <div className={styles.page}>
      <SettingsHeader />
      <SettingsTabs
        label="User access views"
        tabs={[
          { key: 'people', label: 'People', testId: 'tab-people', content: <PeoplePage /> },
          { key: 'teams', label: 'Teams', testId: 'tab-teams', content: <TeamsPage /> },
          { key: 'approvals', label: 'Approvals', testId: 'tab-approvals', content: <ApprovalsPage /> },
        ]}
      />
    </div>
  )
}
