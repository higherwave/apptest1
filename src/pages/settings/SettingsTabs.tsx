import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import styles from './SettingsTabs.module.scss'

export type SettingsTab = { key: string; label: string; testId: string; content: ReactNode }

// The views of an Settings section (People, Teams and Approvals under User Access; AI and System under Usage and Costs). The Settings menu under the title bar lists them and says which is open
// (it reads the same tab list from nav.ts); which one is open is in the address (?tab=people), so it can be linked to and survives a reload. Only the open view's content is built, so a section does not
// load the data of views nobody opened.
export function SettingsTabs({ tabs }: { tabs: SettingsTab[] }) {
  const [params] = useSearchParams()
  const found = tabs.findIndex((t) => t.key === params.get('tab'))
  const index = found < 0 ? 0 : found
  return <div className={styles.tabPanel}>{tabs[index].content}</div>
}
