import { ChartColumn, Folders } from '@carbon/icons-react'
import { Button, Tag } from '@carbon/react'
import type { MouseEvent, ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useProject, useProjectStage } from '../api/hooks'
import { AccessBar } from '../auth/AccessBar'
import type { StepKey } from '../api/client'
import { STEPS } from './nav'
import { StepNav, type StepItem } from './StepNav'
import { Logo } from './Logo'
import { SiteFooter } from './SiteFooter'
import styles from './AppShell.module.scss'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// Two navigation levels: a dark icon rail for the app's areas, and (inside a project or Platform Insights) a light
// panel for that area's steps. Links carry data-label so tests and scripts find them by name, not by their markup.
export function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault()
    navigate(to)
  }

  const project = pathname.match(/^\/projects\/([^/]+)\/([^/]+)/)
  const projectId = project && project[1] !== 'new' ? project[1] : null
  const insights = pathname.startsWith('/insights')
  // Creating a project shows the same steps, with only Test Plan open: the others need a saved project.
  const creating = pathname === '/projects/new'
  // The server says which steps are open; until it answers, none are shown as locked.
  const stage = useProjectStage(projectId ?? undefined)
  const projectDetail = useProject(projectId ?? undefined)
  const hasPanel = !!projectId || creating

  // The steps as the strip shows them: open, locked (with the reason) and which one is showing.
  const stepItems: StepItem[] = STEPS.map((s, i) => {
    const tab = projectId ? stage.data?.tabs[s.key as StepKey] : undefined
    const locked = creating ? s.key !== 'plan' : tab ? !tab.enabled : false
    return {
      key: s.key,
      label: s.label,
      group: s.group,
      number: i + 1,
      to: creating ? '/projects/new' : `/projects/${projectId}/${s.key}`,
      active: creating ? s.key === 'plan' : project?.[2] === s.key,
      locked,
      hint: creating ? 'Create the project first' : (tab?.hint ?? undefined),
    }
  })

  const railLink = (to: string, label: string, icon: ReactNode, active: boolean) => (
    <a href={to} data-label={label} aria-current={active ? 'page' : undefined} className={cx(styles.railLink, active && styles.railActive)} onClick={go(to)}>
      {icon}
      <span>{label}</span>
    </a>
  )

  return (
    <div className={styles.shell}>
      <header className={styles.appbar}>
        {projectId || creating ? (
          <>
            <Button kind="ghost" size="sm" className={styles.back} onClick={() => navigate('/projects')}>
              ← Research Projects
            </Button>
            <span className={styles.divider} aria-hidden />
            <span className={styles.projectName}>{creating ? 'New project' : (projectDetail.data?.name ?? '')}</span>
            {projectDetail.data && !creating && (
              <Tag size="sm" type={projectDetail.data.status === 'analyzed' ? 'green' : 'gray'}>
                {projectDetail.data.status === 'analyzed' ? 'Analyzed' : 'Draft'}
              </Tag>
            )}
          </>
        ) : (
          <>
            <Logo />
            <span className={styles.appName}>Signal Flow</span>
          </>
        )}
        <div className={styles.access}>
          <AccessBar />
        </div>
      </header>

      <nav className={styles.rail} aria-label="Navigation" data-nav>
        {railLink('/insights/themes', 'Platform Insights', <ChartColumn size={24} aria-hidden />, insights)}
        {railLink('/projects', 'Research Projects', <Folders size={24} aria-hidden />, !insights)}
      </nav>

      <div className={styles.stage}>
        {hasPanel && <StepNav items={stepItems} onGo={navigate} />}
        <main className={styles.content}>
          <Outlet />
          <SiteFooter />
        </main>
      </div>
    </div>
  )
}
