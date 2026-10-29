import { OverflowMenu, OverflowMenuItem, Tile } from '@carbon/react'
import type { Project } from '../../api/client'
import { goTo, resumeStep, STAT_STEPS, stepHref, type ProjectStep } from './ProjectStats'
import styles from './ProjectCard.module.scss'

type ProjectCardProps = {
  project: Project
  /** Opens the project on its themes (analyzed) or its plan (draft). */
  onOpen: (project: Project) => void
  /** Opens one step of the project, from a count on the card. */
  onGo: (project: Project, step: ProjectStep) => void
  /** Present only when the person can edit; the menu is not shown otherwise. */
  onRemove?: (project: Project) => void
}

// Presentational: one project as a card. The name is the main link and stretches over the whole card, so a click anywhere opens
// the project; the three counts and the menu sit above that and are links of their own (a link must not sit inside a link).
export function ProjectCard({ project, onOpen, onGo, onRemove }: ProjectCardProps) {
  const analyzed = project.status === 'analyzed'
  const openStep: ProjectStep = analyzed ? 'themes' : 'plan'
  return (
    <div className={styles.wrap}>
      <Tile className={styles.card} data-status={project.status} data-tint={project.color}>
        <div className={styles.top}>
          <p className={styles.name}>
            <a className={styles.open} href={stepHref(project, openStep)} onClick={goTo(() => onOpen(project), openStep)}>
              {project.name}
            </a>
          </p>
        </div>
        <p className={styles.template} title={project.methods.length > 1 ? project.methods.join(', ') : undefined}>
          {project.methods.length ? project.methods.join(', ') : 'No methods'}
        </p>
        <div className={styles.bottom}>
          {analyzed ? (
            <dl className={styles.stats}>
              {STAT_STEPS.map((s) => (
                <div key={s.key}>
                  <dd className={styles.value}>
                    <a className={styles.statLink} href={stepHref(project, s.step)} aria-label={`${project[s.key]} ${s.label}`} onClick={goTo((step) => onGo(project, step), s.step)}>
                      {project[s.key]}
                    </a>
                  </dd>
                  <dt className={styles.label}>{s.label}</dt>
                </div>
              ))}
            </dl>
          ) : (
            <div className={styles.resume}>
              <a className={styles.statLink} href={stepHref(project, resumeStep(project))} onClick={goTo((step) => onGo(project, step), resumeStep(project))}>
                Pick up where you left off →
              </a>
            </div>
          )}
          <p className={styles.status}>{analyzed ? 'Analyzed' : 'Draft'}</p>
        </div>
      </Tile>
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
