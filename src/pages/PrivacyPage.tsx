import { PRIVACY_NOTICE } from '../shell/privacy'
import styles from './PrivacyPage.module.scss'

// A public page (no sign-in needed) with the privacy notice, for the privacy policy link that Google's sign-in form asks for.
export function PrivacyPage() {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Privacy</h1>
      {PRIVACY_NOTICE.map((p) => (
        <p key={p} className={styles.text}>
          {p}
        </p>
      ))}
    </main>
  )
}
