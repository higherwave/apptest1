import { PRIVACY_NOTICE } from './privacy'
import styles from './PrivacyNote.module.scss'

// The notice shown at the foot of every screen.
export function PrivacyNote() {
  return (
    <footer className={styles.note}>
      {PRIVACY_NOTICE.map((p) => (
        <p key={p}>{p}</p>
      ))}
    </footer>
  )
}
