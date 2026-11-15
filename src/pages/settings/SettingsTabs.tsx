import { Tab, TabList, TabPanel, TabPanels, Tabs } from '@carbon/react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import styles from './SettingsTabs.module.scss'

export type SettingsTab = { key: string; label: string; testId: string; content: ReactNode }

// The sub-tabs of an Admin section (as on Experience Categories): which one is open is in the address (?tab=people), so it can be linked to and survives a
// reload. Only the open tab's content is built, so a section does not load the data of tabs nobody opened.
export function SettingsTabs({ label, tabs }: { label: string; tabs: SettingsTab[] }) {
  const [params, setParams] = useSearchParams()
  const found = tabs.findIndex((t) => t.key === params.get('tab'))
  const index = found < 0 ? 0 : found
  return (
    <Tabs selectedIndex={index} onChange={({ selectedIndex }) => setParams({ tab: tabs[selectedIndex].key }, { replace: true })}>
      <TabList aria-label={label}>
        {tabs.map((t) => <Tab key={t.key} data-testid={t.testId}>{t.label}</Tab>)}
      </TabList>
      <TabPanels>
        {tabs.map((t, i) => <TabPanel key={t.key} className={styles.tabPanel}>{i === index && t.content}</TabPanel>)}
      </TabPanels>
    </Tabs>
  )
}
