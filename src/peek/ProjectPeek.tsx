import { ArrowRight } from '@carbon/icons-react'
import { Tag } from '@carbon/react'
import { Link } from 'react-router-dom'
import { useProject, useProjectLaunch, useProjects, useProjectStage, useSpecs } from '../api/hooks'
import panel from '../components/PanelParts.module.scss'
import { RightPanel } from '../components/RightPanel'
import { SkeletonCard, SkeletonRegion } from '../components/Skeletons'
import { stateLabel } from '../pages/launch/launchText'
import styles from './Peek.module.scss'
import { peekHref } from './targets'
import { useLast } from './useLast'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// A project, scaled down: its status and counts, where it has got to, and buttons straight to a step. Read only.
export function ProjectPeek({ id, onClose }: { id: string | null; onClose: () => void }) {
  const shown = useLast(id)
  const project = useProject(shown ?? undefined)
  const p = project.data
  return (
    <RightPanel open={!!id} heading={p?.name ?? 'Project'} label="Project" onClose={onClose}>
      {shown && (
        <div className={panel.body} data-testid="peek-project">
          <div className={panel.scroll}>
            {project.isPending && (
              <SkeletonRegion label="Loading the project">
                <SkeletonCard lines={3} headingWidth="40%" />
              </SkeletonRegion>
            )}
            {project.isError && <p className={panel.help}>This project is not available to you, or it no longer exists.</p>}
            {p && <ProjectBody id={shown} p={p} />}
          </div>
          <div className={panel.actions}>
            <Link className={styles.more} to={peekHref({ kind: 'project', id: shown }, p)} data-testid="peek-more">
              View project in Signal Flow
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </RightPanel>
  )
}

function ProjectBody({ id, p }: { id: string; p: NonNullable<ReturnType<typeof useProject>['data']> }) {
  const stage = useProjectStage(id).data?.tabs
  const specs = useSpecs({ projectId: id }).data
  const launch = useProjectLaunch(id).data?.launch ?? null
  const spec = specs?.find((s) => !s.standalone)
  const teamName = useProjects().data?.find((x) => x.id === id)?.teamName ?? null
  const analyzed = p.status === 'analyzed'
  // Where it has got to, one line per stage; the step's name is a link when the step is open.
  const steps: { name: string; to: string; open: boolean; state: string }[] = [
    { name: 'Research', to: `/projects/${id}/${analyzed ? 'themes' : 'plan'}`, open: true, state: analyzed ? `${plural(p.sessions, 'session')}, ${plural(p.themes, 'theme')}, ${p.highPriority} high priority` : `Draft: ${plural(p.sessions, 'session')} so far, not analyzed yet` },
    { name: 'Requirements', to: `/projects/${id}/requirements`, open: stage?.requirements.enabled ?? false, state: !analyzed ? 'After the research is analyzed' : !spec ? 'Not started' : spec.status === 'published' ? 'Published' : `Draft: ${spec.approved} of ${spec.total} steps approved` },
    { name: 'Stories', to: `/projects/${id}/stories`, open: stage?.stories.enabled ?? false, state: stage?.stories.enabled ? 'On the board' : 'After the requirements are published' },
    { name: 'Launch', to: `/projects/${id}/launch`, open: stage?.launch.enabled ?? false, state: !analyzed ? 'After the research is analyzed' : launch ? stateLabel(launch.summary.state) : 'No launch yet' },
  ]
  return (
    <>
      <section className={panel.section}>
        <div className={styles.chips}>
          <Tag size="sm" type={analyzed ? 'green' : 'gray'}>{analyzed ? 'Analyzed' : 'Draft'}</Tag>
          {teamName && <Tag size="sm" type="gray">{teamName}</Tag>}
        </div>
        <p className={styles.facts}>{p.methods.length ? p.methods.join(', ') : 'No methods chosen'}</p>
        {p.description && <p className={`${styles.facts} ${styles.muted}`}>{p.description}</p>}
        <dl className={styles.stats}>
          {[
            { label: 'Sessions', value: p.sessions },
            { label: 'Themes', value: p.themes },
            { label: 'Measurements', value: p.measurements },
          ].map((s) => (
            <div key={s.label} className={styles.stat}>
              <dd className={styles.statValue}>{s.value}</dd>
              <dt className={styles.statLabel}>{s.label}</dt>
            </div>
          ))}
        </dl>
      </section>
      <section className={panel.section} aria-label="Where it is">
        <h3 className={panel.heading}>Where it is</h3>
        <ul className={styles.steps}>
          {steps.map((s) => (
            <li key={s.name} className={styles.step}>
              {s.open ? <Link className={styles.stepName} to={s.to}>{s.name}</Link> : <span className={`${styles.stepName} ${styles.muted}`}>{s.name}</span>}
              <span className={styles.stepState}>{s.state}</span>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}
