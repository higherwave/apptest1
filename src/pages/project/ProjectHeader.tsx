import { Button, Tag } from '@carbon/react'
import styles from './ProjectHeader.module.scss'

type ProjectHeaderProps = { name: string; status: 'draft' | 'analyzed'; title: string; description: string; onBack: () => void }

// The project's name and status above a step's title, with a way back to the list.
export function ProjectHeader({ name, status, title, description, onBack }: ProjectHeaderProps) {
  return (
    <header className={styles.header}>
      <div className={styles.crumb}>
        <Button kind="ghost" size="sm" onClick={onBack}>
          ← Research Projects
        </Button>
        <span className={styles.name}>{name}</span>
        <Tag size="sm" type={status === 'analyzed' ? 'green' : 'gray'}>
          {status === 'analyzed' ? 'Analyzed' : 'Draft'}
        </Tag>
      </div>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.description}>{description}</p>
    </header>
  )
}
