import { ChartColumn, Folders, Locked } from '@carbon/icons-react'
import type { MouseEvent, ReactNode } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useProjectStage } from '../api/hooks'
import { AccessBar } from '../auth/AccessBar'
import type { StepKey } from '../api/client'
import { INSIGHT_SECTIONS, STEPS, STEP_GROUPS } from './nav'
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
  const hasPanel = !!projectId || creating || insights

  const railLink = (to: string, label: string, icon: ReactNode, active: boolean) => (
    <a href={to} data-label={label} aria-current={active ? 'page' : undefined} className={cx(styles.railLink, active && styles.railActive)} onClick={go(to)}>
      {icon}
      <span>{label}</span>
    </a>
  )

  return (
    <div className={styles.shell}>
      <nav className={styles.rail} aria-label="Navigation" data-nav>
        {railLink('/projects', 'Research Projects', <Folders size={24} aria-hidden />, !insights)}
        {railLink('/insights/themes', 'Platform Insights', <ChartColumn size={24} aria-hidden />, insights)}
      </nav>

      {hasPanel && (
        <nav className={styles.panel} aria-label={insights ? 'Insights' : 'Project steps'} data-nav>
          {(projectId || creating) &&
            STEP_GROUPS.map((group) => (
              <div key={group} className={styles.group}>
                <p className={styles.groupLabel}>{group}</p>
                {STEPS.filter((s) => s.group === group).map((s) => {
                  const tab = projectId ? stage.data?.tabs[s.key as StepKey] : undefined
                  const locked = creating ? s.key !== 'plan' : tab ? !tab.enabled : false
                  const active = creating ? s.key === 'plan' : project?.[2] === s.key
                  const to = creating ? '/projects/new' : `/projects/${projectId}/${s.key}`
                  return (
                    <a
                      key={s.key}
                      href={to}
                      data-label={s.label}
                      aria-current={active ? 'page' : undefined}
                      aria-disabled={locked || undefined}
                      title={locked ? (creating ? 'Create the project first' : (tab?.hint ?? undefined)) : undefined}
                      className={cx(styles.step, active && styles.stepActive, locked && styles.locked)}
                      onClick={locked || creating ? (e: MouseEvent) => e.preventDefault() : go(to)}
                    >
                      <span className={styles.number} aria-hidden>{STEPS.indexOf(s) + 1}</span>
                      <span className={styles.stepLabel}>{s.label}</span>
                      {locked && <Locked size={16} className={styles.lock} aria-hidden />}
                    </a>
                  )
                })}
              </div>
            ))}

          {insights && (
            <div className={styles.group}>
              <p className={styles.groupLabel}>Insights</p>
              {INSIGHT_SECTIONS.map((s) => {
                const to = `/insights/${s.key}`
                const active = pathname === to
                return (
                  <a key={s.key} href={to} data-label={s.label} aria-current={active ? 'page' : undefined} className={cx(styles.step, active && styles.stepActive)} onClick={go(to)}>
                    <span className={styles.stepLabel}>{s.label}</span>
                  </a>
                )
              })}
            </div>
          )}
        </nav>
      )}

      <main className={cx(styles.content, hasPanel && styles.withPanel)}>
        <AccessBar />
        <Outlet />
      </main>
    </div>
  )
}
