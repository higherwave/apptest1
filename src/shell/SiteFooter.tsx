import { PRIVACY_NOTICE } from './privacy'
import styles from './SiteFooter.module.scss'

// The footer of every screen, the same as the landing page's: the mark and name, the testing-environment notice, and the links.
// Inside the app it runs the full width of the page and sits at the foot of the window on a short page.
export function SiteFooter() {
  return (
    <div className={styles.slot}>
      <footer className={styles.footer}>
        <div className={styles.inner}>
          <p className={styles.brand}>
            <img className={styles.mark} src="/landing-icon.png" alt="" width={32} height={32} />
            <span>Signal Flow</span>
          </p>
          <div className={styles.legal}>
            {PRIVACY_NOTICE.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <p>
              <a href="/privacy.html">Privacy policy</a> · <a href="/about.html">About</a> · Signal Flow is run by Higherwave (higherwave.org).
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
