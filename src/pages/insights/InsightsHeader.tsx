import styles from './InsightsHeader.module.scss'

// The title and description above every Platform Insights screen.
export function InsightsHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.description}>{description}</p>
    </header>
  )
}
