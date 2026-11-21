import { ChevronLeft } from '@carbon/icons-react'
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useProject, useProjectStage } from '../api/hooks'
import type { StepKey } from '../api/client'
import { STEPS, stepStates } from './nav'
import { StepNav, useRailWide, type StepItem } from './StepNav'
import { AppHeader } from './AppHeader'
import { SiteFooter } from './SiteFooter'
import { SpendBanner } from './SpendBanner'
import { StatusTag } from './StatusTag'
import { noteVisit } from '../resume/recent'
import { useReportTimeZone } from './useReportTimeZone'
import styles from './AppShell.module.scss'

// Two navigation levels: the dark app header (AppHeader), and inside a project a light
// strip of that project's steps. Links carry data-label so tests and scripts find them by name, not by their markup.
export function AppShell() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  // The spend alert sits above the fixed app bar; it reports its height so everything below moves down by that much.
  const shell = useRef<HTMLDivElement>(null)
  const onBanner = useCallback((rem: number) => shell.current?.style.setProperty('--at-banner', `${rem}rem`), [])

  // Remember the project page being viewed, so the Platform Insights home can offer a way straight back to it.
  useEffect(() => noteVisit(pathname, search), [pathname, search])
  useReportTimeZone()

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault()
    navigate(to)
  }

  const project = pathname.match(/^\/projects\/([^/]+)\/([^/]+)/)
  const projectId = project && project[1] !== 'new' ? project[1] : null
  // Creating a project shows the same steps, with only Test Plan open: the others need a saved project.
  const creating = pathname === '/projects/new'
  // The server says which steps are open; until it answers, none are shown as locked.
  const stage = useProjectStage(projectId ?? undefined)
  const projectDetail = useProject(projectId ?? undefined)
  const hasPanel = !!projectId || creating

  // The steps as the strip shows them: open, locked (with the reason) and which one is showing.
  const open = STEPS.map((s) => {
    const tab = projectId ? stage.data?.tabs[s.key as StepKey] : undefined
    return creating ? s.key === 'plan' : tab ? tab.enabled : true
  })
  const { states } = stepStates(open)
  const railWide = useRailWide()
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
      state: states[i],
      hint: creating ? 'Create the project first' : (tab?.hint ?? undefined),
    }
  })

  return (
    <div className={styles.shell} ref={shell}>
      <SpendBanner onHeight={onBanner} />
      <AppHeader />

      {hasPanel && (
        <div className={styles.context} data-context data-rail={railWide}>
          <div className={styles.contextInner}>
            <a href="/projects" data-label="All projects" aria-label="All projects" title="All projects" className={styles.back} onClick={go('/projects')}>
              <ChevronLeft size={20} aria-hidden />
            </a>
            <span className={styles.projectName}>{creating ? 'New project' : (projectDetail.data?.name ?? '')}</span>
            {projectDetail.data && !creating && (
              <StatusTag status={projectDetail.data.status} />
            )}
          </div>
        </div>
      )}

      <div className={styles.stage} data-project={hasPanel} data-rail={hasPanel && railWide}>
        {hasPanel && <StepNav items={stepItems} onGo={navigate} />}
        <main className={styles.content}>
          {hasPanel ? (
            <div className={styles.column} data-testid="page-column">
              <Outlet />
            </div>
          ) : (
            <Outlet />
          )}
        </main>
      </div>
      <SiteFooter flush />
    </div>
  )
}
