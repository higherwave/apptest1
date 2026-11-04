import styles from './Logo.module.scss'

// The Signal Flow mark, 36px (the file is 144px so it stays sharp on high-density screens). It sits beside the
// app's name, so it is decorative for screen readers.
export function Logo() {
  return <img className={styles.logo} src="/logo.png" alt="" width={36} height={36} />
}
