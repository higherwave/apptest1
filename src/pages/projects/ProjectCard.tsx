import { ClickableTile, OverflowMenu, OverflowMenuItem, Tag } from '@carbon/react'
import type { Project } from '../../api/client'
import styles from './ProjectCard.module.scss'

type ProjectCardProps = {
  project: Project
  onOpen: (project: Project) => void
  /** Present only when the person can edit; the menu is not shown otherwise. */
  onRemove?: (project: Project) => void
}

// Presentational: one project as a tinted card. The whole card is one action, so it is a ClickableTile.
export function ProjectCard({ project, onOpen, onRemove }: ProjectCardProps) {
  const analyzed = project.status === 'analyzed'
  return (
    <div className={styles.wrap}>
    <ClickableTile className={styles.card} data-tint={project.color} onClick={() => onOpen(project)}>
      <div className={styles.top}>
        <p className={styles.name}>{project.name}</p>
      </div>
      <p className={styles.template}>{project.template ?? 'No template'}</p>
      <div className={styles.bottom}>
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
      <Tag className={styles.status} size="sm" type={analyzed ? 'green' : 'gray'}>
        {analyzed ? 'Analyzed' : 'Draft'}
      </Tag>
      </div>
    </ClickableTile>
    {onRemove && (
      <div className={styles.menu}>
        <OverflowMenu iconDescription={`Actions for ${project.name}`} flipped size="sm">
          <OverflowMenuItem itemText="Remove project" isDelete onClick={() => onRemove(project)} />
        </OverflowMenu>
      </div>
    )}
    </div>
  )
}
