import styles from './Logo.module.scss'

// The Signal Flow mark, small (24px; the file is 96px so it stays sharp on high-density screens). It sits beside the
// app's name, so it is decorative for screen readers.
export function Logo() {
  return <img className={styles.logo} src="/logo.png" alt="" width={24} height={24} />
}
