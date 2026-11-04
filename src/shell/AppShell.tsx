import { Analytics, ChevronDown, Filter, Launch, Settings as SettingsIcon } from '@carbon/icons-react'
import { Button, Tag } from '@carbon/react'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useProject, useProjectStage } from '../api/hooks'
import { AccessBar } from '../auth/AccessBar'
import { AiBadge } from '../auth/AiBadge'
import type { StepKey } from '../api/client'
import { STEPS } from './nav'
import { StepNav, type StepItem } from './StepNav'
import { Logo } from './Logo'
import { SiteFooter } from './SiteFooter'
import { SpendBanner } from './SpendBanner'
import styles from './AppShell.module.scss'
import brand from '../../brand/brand.json'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// Two navigation levels: a dark header with the app's areas (a dropdown on narrow screens), and inside a project a light
// strip of that project's steps. Links carry data-label so tests and scripts find them by name, not by their markup.
export function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  // The spend alert sits above the fixed app bar; it reports its height so everything below moves down by that much.
  const shell = useRef<HTMLDivElement>(null)
  const onBanner = useCallback((rem: number) => shell.current?.style.setProperty('--at-banner', `${rem}rem`), [])

  const go = (to: string) => (event: MouseEvent) => {
    event.preventDefault()
    setMenuOpen(false)
    navigate(to)
  }

  const project = pathname.match(/^\/projects\/([^/]+)\/([^/]+)/)
  const projectId = project && project[1] !== 'new' ? project[1] : null
  // Every project step shares one centered column; the Journey Map and Stories need the room, so theirs is wider (the project bar and the step strip stay at the shared width everywhere).
  const wide = project?.[2] === 'journey' || project?.[2] === 'stories'
  const insights = pathname.startsWith('/insights')
  const settings = pathname.startsWith('/settings')
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
    { to: '/insights/themes', label: 'Platform Insights', active: insights, icon: Analytics },
    { to: '/projects', label: 'Product Funnel', active: !insights && !settings, icon: Filter },
    { to: '/settings/areas', label: 'Settings', active: settings, icon: SettingsIcon },
  ]
  const current = areas.find((a) => a.active) ?? areas[0]
  // The prototype gallery lives elsewhere: it opens in its own tab. Its address is a brand setting; with none, the link is not shown.
  const gallery = brand.galleryUrl as string | undefined

  return (
    <div className={styles.shell} ref={shell} data-wide={wide}>
      <SpendBanner onHeight={onBanner} />
      <aside className={styles.rail} aria-label="Main menu">
        <div className={styles.brand}>
          <Logo />
          <span className={styles.appName}>{brand.appName}</span>
        </div>

        <nav className={styles.areas} aria-label="Navigation" data-nav>
          {areas.map((a) => (
            <a key={a.to} href={a.to} data-label={a.label} aria-current={a.active ? 'page' : undefined} className={cx(styles.area, a.active && styles.areaActive)} onClick={go(a.to)}>
              <a.icon size={20} aria-hidden />
              {a.label}
            </a>
          ))}
          {gallery && (
            <a href={gallery} data-label="Prototype gallery" target="_blank" rel="noopener noreferrer" className={cx(styles.area, styles.areaExternal)}>
              <Launch size={20} aria-hidden />
              Prototype gallery
              <span className={styles.srOnly}> (opens in a new tab)</span>
            </a>
          )}
        </nav>
      </aside>

      <header className={styles.topbar}>
        <div className={styles.narrowBrand}>
          <Logo />
          <span className={styles.appName}>{brand.appName}</span>
        </div>
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
              {gallery && (
                <a href={gallery} role="menuitem" target="_blank" rel="noopener noreferrer" className={styles.menuItem}>
                  Prototype gallery
                </a>
              )}
            </div>
          )}
        </div>
        <div className={styles.aiBadge}>
          <AiBadge />
        </div>
        <div className={styles.access}>
          <AccessBar />
        </div>
      </header>

      {hasPanel && (
        <div className={styles.context} data-context>
          <div className={styles.contextInner}>
            <span className={styles.projectName}>{creating ? 'New project' : (projectDetail.data?.name ?? '')}</span>
            {projectDetail.data && !creating && (
              <Tag size="sm" type={projectDetail.data.status === 'analyzed' ? 'green' : 'gray'}>
                {projectDetail.data.status === 'analyzed' ? 'Analyzed' : 'Draft'}
              </Tag>
            )}
          </div>
        </div>
      )}

      <div className={styles.stage} data-project={hasPanel}>
        {hasPanel && <StepNav items={stepItems} onGo={navigate} />}
        <main className={styles.content}>
          {hasPanel ? (
            <div className={styles.column} data-testid="page-column">
              <Outlet />
            </div>
          ) : (
            <Outlet />
          )}
          <SiteFooter />
        </main>
      </div>
    </div>
  )
}
