import styles from './ProjectHeader.module.scss'

type ProjectHeaderProps = { title: string; description: string }

// A step's title and one line about it. The project's name and the way back live in the app header.
export function ProjectHeader({ title, description }: ProjectHeaderProps) {
  return (
    <header className={styles.header}>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.description}>{description}</p>
    </header>
  )
}
