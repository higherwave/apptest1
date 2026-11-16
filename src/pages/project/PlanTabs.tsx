import { Tab, TabList, Tabs } from '@carbon/react'
import { useNavigate } from 'react-router-dom'
import styles from './PlanTabs.module.scss'

export const PLAN_TABS = [
  { key: 'test', label: 'What to test', path: 'plan' },
  { key: 'ask', label: 'What to ask or observe', path: 'plan/ask' },
] as const

// The two tabs of the Test Plan. Each is its own address (so a link or a tour can open either), and the page that is showing
// draws the strip, so a tab's own unsaved edits are never left behind in a hidden panel.
// Before the project exists (a new test plan) there is nowhere to go yet: the strip is the same and the second tab waits until the plan is saved.
export function PlanTabs({ projectId, active }: { projectId?: string; active: (typeof PLAN_TABS)[number]['key'] }) {
  const navigate = useNavigate()
  return (
    <Tabs selectedIndex={PLAN_TABS.findIndex((t) => t.key === active)} onChange={({ selectedIndex }) => projectId && navigate(`/projects/${projectId}/${PLAN_TABS[selectedIndex].path}`)}>
      <TabList aria-label="Test plan sections" className={styles.tabs}>
        {PLAN_TABS.map((t) => (
          <Tab key={t.key} data-testid={`plan-tab-${t.key}`} disabled={!projectId && t.key !== active}>{t.label}</Tab>
        ))}
      </TabList>
    </Tabs>
  )
}
