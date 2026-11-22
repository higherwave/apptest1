import { ApprovalsPage } from '../approvals/ApprovalsPage'
import { PeoplePage } from '../people/PeoplePage'
import { TeamsPage } from '../teams/TeamsPage'
import { SettingsTabs } from './SettingsTabs'
import styles from './SettingsSection.module.scss'
import { T } from '../../../shared/terms.mjs'

// Settings, User Access: who is in the workspace (People), how they are grouped (Teams) and who approves each launch step (Approvals). Owners only.
export function AccessPage() {
  return (
    <div className={styles.page}>
      <SettingsTabs
        tabs={[
          { key: 'people', label: 'People', testId: 'tab-people', content: <PeoplePage /> },
          { key: 'teams', label: 'Teams', testId: 'tab-teams', content: <TeamsPage /> },
          { key: 'approvals', label: `${T.Approvals}`, testId: 'tab-approvals', content: <ApprovalsPage /> },
        ]}
      />
    </div>
  )
}
