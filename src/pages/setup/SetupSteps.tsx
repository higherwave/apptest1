import { Checkbox, InlineNotification, Loading, Tag } from '@carbon/react'
import { useJiraStatus } from '../../api/hooks'
import { ApprovalsPage } from '../approvals/ApprovalsPage'
import { AreasPage } from '../areas/AreasPage'
import { PeoplePage } from '../people/PeoplePage'
import { TeamsPage } from '../teams/TeamsPage'
import { GUARD_ITEMS, type SetupKey } from './setupText'
import styles from './SetupSteps.module.scss'

// The "Set up" step of each category: the real Settings screens, shown here so nobody has to leave the setup. Later changes are made in Settings as usual.
export function SetupStep({ category, confirmed, onConfirm }: { category: SetupKey; confirmed: boolean[]; onConfirm: (index: number, on: boolean) => void }) {
  switch (category) {
    case 'people':
      return (
        <div className={styles.stack}>
          <section aria-labelledby="setup-teams">
            <h3 id="setup-teams" className={styles.heading}>Teams</h3>
            <TeamsPage />
          </section>
          <section aria-labelledby="setup-people">
            <h3 id="setup-people" className={styles.heading}>People</h3>
            <PeoplePage />
          </section>
        </div>
      )
    case 'approvals':
      return <ApprovalsPage />
    case 'categories':
      return <AreasPage embedded />
    case 'connections':
      return <ConnectionsStep />
    case 'guard':
      return (
        <div className={styles.stack}>
          {GUARD_ITEMS.map((g, i) => (
            <section key={g.title} className={styles.read}>
              <h3 className={styles.heading}>{g.title}</h3>
              <p className={styles.text}>{g.text}</p>
              <Checkbox id={`setup-confirm-${i}`} labelText={g.confirm} checked={confirmed[i] ?? false} onChange={(_, { checked }) => onConfirm(i, checked)} />
            </section>
          ))}
        </div>
      )
  }
}

// Slack and Jira are connected with us during a pilot (their tokens are kept encrypted). Here an owner sees where they stand and sets each team's Slack channel.
function ConnectionsStep() {
  const jira = useJiraStatus(true)
  return (
    <div className={styles.stack}>
      <section className={styles.cards} aria-label="Connections">
        <div className={styles.card} data-testid="setup-jira">
          <h3 className={styles.heading}>Jira</h3>
          {jira.isPending ? <Loading small withOverlay={false} description="Checking Jira" /> : jira.data?.connected ? <Tag size="sm" type="green">Connected</Tag> : <Tag size="sm" type="gray">Not connected</Tag>}
          <p className={styles.text}>{jira.data?.connected ? 'Tickets are created as real issues.' : 'Until it is connected, tickets are simulated and nothing is sent. We connect it with you.'}</p>
        </div>
        <div className={styles.card}>
          <h3 className={styles.heading}>Slack</h3>
          <p className={styles.text}>Each team posts its launches in a channel of its own. Choose a team below and set its Slack channel.</p>
        </div>
      </section>
      <InlineNotification kind="info" lowContrast hideCloseButton title="Set up with us" subtitle="The connections themselves are made with you during the pilot. This step only checks where they stand, and you can skip it." />
      <section aria-labelledby="setup-channels">
        <h3 id="setup-channels" className={styles.heading}>Teams and their Slack channels</h3>
        <TeamsPage />
      </section>
    </div>
  )
}
