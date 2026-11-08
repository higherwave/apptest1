import { CheckmarkFilled } from '@carbon/icons-react'
import { Button, Modal } from '@carbon/react'
import brand from '../../brand/brand.json'
import { TOURS } from './tours'
import styles from './WelcomeDialog.module.scss'

type Props = { open: boolean; finished: string[]; starting: boolean; onStart: (id: string) => void; onClose: () => void }

// The welcome screen: what Signal Flow is, in the story the demo tells, and the tours to pick from. Opens on a read-only visitor's first
// visit and any time from "Take a tour" in the header.
export function WelcomeDialog({ open, finished, starting, onStart, onClose }: Props) {
  return (
    <Modal open={open} passiveModal size="md" modalLabel="Welcome" modalHeading={`Welcome to ${brand.appName}`} onRequestClose={onClose} className={styles.dialog}>
      <p className={styles.lead}>
        Meet Anchor CX, a company that makes software for customer-success teams. Its leaders wanted to know why customers had stopped trusting the account health score. {brand.appName} is how the team found out: it turns what customers say into themes, then requirements, then tickets ready for Jira.
      </p>
      <p className={styles.lead}>Everything here is a read-only sample. Take a short guided tour, or look around on your own.</p>
      <div className={styles.tours} role="list">
        {TOURS.map((t) => (
          <div className={styles.tour} role="listitem" key={t.id}>
            <div>
              <h3 className={styles.name}>
                {t.title}
                {finished.includes(t.id) && <CheckmarkFilled size={16} className={styles.done} aria-label="Finished" />}
              </h3>
              <p className={styles.summary}>{t.summary}</p>
              <p className={styles.time}>About {t.minutes} minutes</p>
            </div>
            <Button kind="primary" size="md" disabled={starting} onClick={() => onStart(t.id)} data-testid={`start-${t.id}`}>
              {finished.includes(t.id) ? 'Take it again' : 'Start'}
            </Button>
          </div>
        ))}
      </div>
      <div className={styles.footer}>
        <Button kind="ghost" size="md" onClick={onClose} data-testid="welcome-skip">
          Explore on my own
        </Button>
        <span className={styles.hint}>You can come back any time from Take a tour, at the top of the page.</span>
      </div>
    </Modal>
  )
}
