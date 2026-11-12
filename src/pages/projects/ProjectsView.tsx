import { Button, Dropdown, InlineNotification, Loading, Modal, OverflowMenu, OverflowMenuItem, Tile } from '@carbon/react'
import { useState } from 'react'
import type { Project } from '../../api/client'
import { PageHero } from '../../shell/PageHero'
import { StatusTag } from '../../shell/StatusTag'
import { ProjectCard } from './ProjectCard'
import { goTo, STAT_STEPS, stepHref, type ProjectStep } from './ProjectStats'
import styles from './ProjectsView.module.scss'

export type ProjectsViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  projects: Project[]
  errorText?: string
  /** The demo is read-only for visitors without the token, so creating a project is unavailable. */
  readOnly: boolean
  onOpen: (project: Project) => void
  /** Opens one step of a project, from a count on its card or row. */
  onGo: (project: Project, step: ProjectStep) => void
  onNew: () => void
  /** Present only when the person can edit. */
  onRemove?: (project: Project) => void
  /** The project awaiting a delete confirmation, if any. */
  removing: Project | null
  removePending: boolean
  removeError?: string
  onConfirmRemove: () => void
  onCancelRemove: () => void
  /** Whether the person may change this project (they edit in its team). Projects they may only read show "View only" and have no remove menu. */
  canChange: (project: Project) => boolean
}

type Layout = 'cards' | 'list'
const LAYOUT_KEY = 'signalflow.projects.layout'
const readLayout = (): Layout => {
  try {
    return localStorage.getItem(LAYOUT_KEY) === 'list' ? 'list' : 'cards'
  } catch {
    return 'cards'
  }
}

// Presentational: loading, error, empty and ready are all declared here. Data comes from the container.
export function ProjectsView({ state, projects, errorText, readOnly, onOpen, onGo, onNew, onRemove, removing, removePending, removeError, onConfirmRemove, onCancelRemove, canChange }: ProjectsViewProps) {
  const [layout, setLayout] = useState<Layout>(readLayout)
  const [teamFilter, setTeamFilter] = useState('all')
  // With more than one team's projects in the list, each says which team it is, and the list can be narrowed to one.
  const teams = [...new Map(projects.filter((p) => p.teamId).map((p) => [p.teamId as string, p.teamName ?? ''])).entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name))
  const showTeams = teams.length > 1
  const shown = showTeams && teamFilter !== 'all' ? projects.filter((p) => p.teamId === teamFilter) : projects
  const choose = (next: Layout) => {
    setLayout(next)
    try {
      localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // the choice just is not remembered
    }
  }

  return (
    <div className={styles.page}>
      <PageHero title="Projects" description="From research to release">
        <Button kind="primary" disabled={readOnly} onClick={onNew}>
          New project
        </Button>
      </PageHero>

      <div className={styles.body}>
      {state === 'loading' && <Loading small withOverlay={false} description="Loading projects" />}

      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Projects" subtitle={errorText} />}

      {state === 'empty' && (
        <Tile className={styles.empty}>
          <p className={styles.emptyTitle}>No projects yet</p>
          <p className={styles.emptyText}>Start a project to plan a study and add transcripts.</p>
        </Tile>
      )}

      {state === 'ready' && (
        <>
          <div className={styles.toolbar}>
            <div className={styles.countRow}>
              <p className={styles.count}>{shown.length === 1 ? '1 project' : `${shown.length} projects`}</p>
              {showTeams && (
                <Dropdown
                  id="project-team-filter"
                  className={styles.teamFilter}
                  titleText="Team"
                  hideLabel
                  label="All teams"
                  size="sm"
                  items={[{ id: 'all', name: 'All teams' }, ...teams]}
                  itemToString={(t) => t?.name ?? ''}
                  selectedItem={teamFilter === 'all' ? { id: 'all', name: 'All teams' } : (teams.find((t) => t.id === teamFilter) ?? null)}
                  onChange={({ selectedItem }) => selectedItem && setTeamFilter(selectedItem.id)}
                />
              )}
            </div>
            <div className={styles.switch} role="group" aria-label="Show projects as">
              <Button kind={layout === 'cards' ? 'primary' : 'ghost'} size="sm" aria-pressed={layout === 'cards'} onClick={() => choose('cards')}>
                Cards
              </Button>
              <Button kind={layout === 'list' ? 'primary' : 'ghost'} size="sm" aria-pressed={layout === 'list'} onClick={() => choose('list')}>
                List
              </Button>
            </div>
          </div>
          {layout === 'cards' ? (
            <div className={styles.grid}>
              {shown.map((project) => (
                <ProjectCard key={project.id} project={project} onOpen={onOpen} onGo={onGo} onRemove={onRemove} team={showTeams ? (project.teamName ?? undefined) : undefined} viewOnly={!canChange(project)} />
              ))}
            </div>
          ) : (
            <div className={styles.list} role="table" aria-label="Projects">
              <div className={`${styles.listRow} ${styles.listHead}`} role="row">
                <span role="columnheader">Project</span>
                <span role="columnheader">Methods</span>
                <span role="columnheader">Status</span>
                {STAT_STEPS.map((s) => (
                  <span key={s.key} role="columnheader">
                    {s.label}
                  </span>
                ))}
                <span role="columnheader" aria-label="Actions" />
              </div>
              {shown.map((project) => {
                const openStep: ProjectStep = project.status === 'analyzed' ? 'themes' : 'plan'
                return (
                  <div key={project.id} className={styles.listRow} role="row" data-testid={`project-row-${project.id}`} data-status={project.status}>
                    <span role="cell" className={styles.rowProject} data-status={project.status} data-tint={project.color}>
                      <a className={styles.rowName} href={stepHref(project, openStep)} onClick={goTo(() => onOpen(project), openStep)}>
                        {project.name}
                      </a>
                    </span>
                    <span role="cell" className={styles.rowMuted} title={project.methods.length > 1 ? project.methods.join(', ') : undefined}>
                      {project.methods.length ? project.methods.join(', ') : 'No methods'}
                      {showTeams && project.teamName ? ` · ${project.teamName}${canChange(project) ? '' : ' · View only'}` : ''}
                    </span>
                    <span role="cell">
                      <StatusTag status={project.status} />
                    </span>
                    {STAT_STEPS.map((s) => (
                      <span key={s.key} role="cell">
                        {project.status === 'analyzed' ? (
                          <a className={styles.rowLink} href={stepHref(project, s.step)} aria-label={`${project[s.key]} ${s.label} of ${project.name}`} onClick={goTo((step) => onGo(project, step), s.step)}>
                          {project[s.key]}
                        </a>
                        ) : (
                          project[s.key]
                        )}
                      </span>
                    ))}
                    <span role="cell">
                      {onRemove && canChange(project) && (
                        <OverflowMenu iconDescription={`Actions for ${project.name}`} flipped size="sm">
                          <OverflowMenuItem itemText="Remove project" isDelete onClick={() => onRemove(project)} />
                        </OverflowMenu>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      </div>

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
