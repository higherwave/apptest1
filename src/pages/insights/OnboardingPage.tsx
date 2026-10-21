import { Tag } from '@carbon/react'
import { InsightsHeader } from './InsightsHeader'
import styles from './OnboardingPage.module.scss'

// Onboarding is a placeholder in the prototype too: nothing to load, nothing to save.
export function OnboardingPage() {
  return (
    <div className={styles.page}>
      <InsightsHeader title="Onboarding" description="A starting point for people new to the team" />
      <Tag size="sm" type="gray">
        Coming soon
      </Tag>
      <p className={styles.text}>Onboarding content coming soon.</p>
    </div>
  )
}
