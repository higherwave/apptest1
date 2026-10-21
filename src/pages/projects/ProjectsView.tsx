import { Button, InlineNotification, Loading, Modal, Tile } from '@carbon/react'
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
  /** Present only when the person can edit. */
  onRemove?: (project: Project) => void
  /** The project awaiting a delete confirmation, if any. */
  removing: Project | null
  removePending: boolean
  removeError?: string
  onConfirmRemove: () => void
  onCancelRemove: () => void
}

// Presentational: loading, error, empty and ready are all declared here. Data comes from the container.
export function ProjectsView({ state, projects, errorText, readOnly, onOpen, onNew, onRemove, removing, removePending, removeError, onConfirmRemove, onCancelRemove }: ProjectsViewProps) {
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
            <ProjectCard key={project.id} project={project} onOpen={onOpen} onRemove={onRemove} />
          ))}
        </div>
      )}

      <Modal
        open={removing !== null}
        danger
        size="sm"
        modalHeading="Remove this project?"
        primaryButtonText={removePending ? 'Removing…' : 'Remove permanently'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={removePending}
        onRequestClose={onCancelRemove}
        onRequestSubmit={onConfirmRemove}
      >
        <p className={styles.confirm}>
          This permanently deletes <strong>{removing?.name}</strong> and everything under it: its plan, transcripts, themes and requirements. It cannot be undone.
        </p>
        {removeError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not removed" subtitle={removeError} />}
      </Modal>
    </div>
  )
}
