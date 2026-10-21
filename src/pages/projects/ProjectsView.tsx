import { Button, InlineNotification, Loading, Tile } from '@carbon/react'
import type { Project } from '../../api/client'
import { ProjectCard } from './ProjectCard'
import styles from './ProjectsView.module.scss'

export type ProjectsViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  projects: Project[]
  errorText?: string
  /** The demo is read-only for visitors without the token, so creating a project is unavailable. */
  readOnly: boolean
  onOpen: (project: Project) => void
  onNew: () => void
}

// Presentational: loading, error, empty and ready are all declared here. Data comes from the container.
export function ProjectsView({ state, projects, errorText, readOnly, onOpen, onNew }: ProjectsViewProps) {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Research Projects</h1>
          <p className={styles.lede}>Plan a study, analyze transcripts, and turn themes into requirements.</p>
        </div>
        <Button kind="primary" disabled={readOnly} onClick={onNew}>
          New project
        </Button>
      </header>

      {readOnly && (
        <InlineNotification kind="info" lowContrast hideCloseButton title="Read-only demo" subtitle="You can look around, but changes need the access token." />
      )}

      {state === 'loading' && <Loading small withOverlay={false} description="Loading projects" />}

      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Projects" subtitle={errorText} />}

      {state === 'empty' && (
        <Tile className={styles.empty}>
          <p className={styles.emptyTitle}>No projects yet</p>
          <p className={styles.emptyText}>Start a project to plan a study and add transcripts.</p>
        </Tile>
      )}

      {state === 'ready' && (
        <div className={styles.grid}>
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onOpen={onOpen} />
          ))}
        </div>
      )}
    </div>
  )
}
