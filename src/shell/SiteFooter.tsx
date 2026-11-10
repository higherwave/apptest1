import { PRIVACY_NOTICE } from './privacy'
import styles from './SiteFooter.module.scss'
import brand from '../../brand/brand.json'

// The footer of every screen, the same as the landing page's: the mark and name, the testing-environment notice, and the links.
// Inside the app it runs the full width beside the app menu and sits at the foot of the window on a short page.
export function SiteFooter({ flush = false }: { /** True when the footer sits on its own across the full width, not inside a padded page. */ flush?: boolean }) {
  return (
    <div className={styles.slot} data-flush={flush}>
      <footer className={styles.footer}>
        <div className={styles.inner}>
          <p className={styles.brand}>
            <img className={styles.mark} src="/landing-icon.png" alt="" width={32} height={32} />
            <span>{brand.appName}</span>
          </p>
          <div className={styles.legal}>
            {PRIVACY_NOTICE.map((p) => (
              <p key={p}>{p}</p>
            ))}
            <p>
              <a href="/privacy.html">Privacy policy</a> · <a href="/about.html">About</a> · {brand.appName} is run by {brand.orgName} ({brand.orgDomain}).
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
