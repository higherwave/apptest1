import { ClickableTile, Tag } from '@carbon/react'
import type { Project } from '../../api/client'
import styles from './ProjectCard.module.scss'

type ProjectCardProps = { project: Project; onOpen: (project: Project) => void }

// Presentational: one project as a tinted card. The whole card is one action, so it is a ClickableTile.
export function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const analyzed = project.status === 'analyzed'
  return (
    <ClickableTile className={styles.card} data-tint={project.color} onClick={() => onOpen(project)}>
      <div className={styles.top}>
        <p className={styles.name}>{project.name}</p>
        <Tag className={styles.status} size="sm" type={analyzed ? 'green' : 'gray'}>
          {analyzed ? 'Analyzed' : 'Draft'}
        </Tag>
      </div>
      <p className={styles.template}>{project.template ?? 'No template'}</p>
      <dl className={styles.stats}>
        <div>
          <dd className={styles.value}>{project.sessions}</dd>
          <dt className={styles.label}>Sessions</dt>
        </div>
        <div>
          <dd className={styles.value}>{project.themes}</dd>
          <dt className={styles.label}>Themes</dt>
        </div>
        <div>
          <dd className={styles.value}>{project.highPriority}</dd>
          <dt className={styles.label}>High priority</dt>
        </div>
      </dl>
    </ClickableTile>
  )
}
