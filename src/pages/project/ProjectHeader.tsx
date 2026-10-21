import { SaveControls, type SaveBarProps } from './SaveBar'
import styles from './ProjectHeader.module.scss'

type ProjectHeaderProps = { title: string; description: string; /** On pages that save: the Save button and state, shown at the right of the title. */ save?: SaveBarProps }

// A step's title and one line about it, with Save and its state at the right where the page saves. The project's name
// and the way back live in the app header.
export function ProjectHeader({ title, description, save }: ProjectHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      {save && <SaveControls {...save} />}
    </header>
  )
}
