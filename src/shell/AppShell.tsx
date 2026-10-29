import { ChevronDown } from '@carbon/icons-react'
import { Button, Tag } from '@carbon/react'
import { useState, type MouseEvent } from 'react'
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

// Two navigation levels: a dark header with the app's areas (a dropdown on narrow screens), and inside a project a light
// strip of that project's steps. Links carry data-label so tests and scripts find them by name, not by their markup.
export function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault()
    setMenuOpen(false)
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

  const areas = [
    { to: '/insights/themes', label: 'Platform Insights', active: insights },
    { to: '/projects', label: 'Research Projects', active: !insights },
  ]
  const current = areas.find((a) => a.active) ?? areas[0]

  return (
    <div className={styles.shell}>
      <header className={styles.appbar}>
        <div className={styles.brand}>
          <Logo />
          <span className={styles.appName}>Signal Flow</span>
        </div>

        <nav className={styles.areas} aria-label="Navigation" data-nav>
          {areas.map((a) => (
            <a key={a.to} href={a.to} data-label={a.label} aria-current={a.active ? 'page' : undefined} className={cx(styles.area, a.active && styles.areaActive)} onClick={go(a.to)}>
              {a.label}
            </a>
          ))}
        </nav>

        <div className={styles.menu} data-menu>
          <Button kind="ghost" size="sm" className={styles.menuButton} renderIcon={ChevronDown} aria-haspopup="true" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
            {current.label}
          </Button>
          {menuOpen && (
            <div className={styles.menuList} role="menu">
              {areas.map((a) => (
                <a key={a.to} href={a.to} role="menuitem" aria-current={a.active ? 'page' : undefined} className={cx(styles.menuItem, a.active && styles.menuItemActive)} onClick={go(a.to)}>
                  {a.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className={styles.access}>
          <AccessBar />
        </div>
      </header>

      {hasPanel && (
        <div className={styles.context} data-context>
          <span className={styles.projectName}>{creating ? 'New project' : (projectDetail.data?.name ?? '')}</span>
          {projectDetail.data && !creating && (
            <Tag size="sm" type={projectDetail.data.status === 'analyzed' ? 'green' : 'gray'}>
              {projectDetail.data.status === 'analyzed' ? 'Analyzed' : 'Draft'}
            </Tag>
          )}
        </div>
      )}

      <div className={styles.stage} data-project={hasPanel}>
        {hasPanel && <StepNav items={stepItems} onGo={navigate} />}
        <main className={styles.content}>
          <Outlet />
          <SiteFooter />
        </main>
      </div>
    </div>
  )
}
