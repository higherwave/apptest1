import { Analytics, ChevronDown, ChevronLeft, Filter, Help, Launch, Settings as SettingsIcon } from '@carbon/icons-react'
import { Button, Tag } from '@carbon/react'
import { useCallback, useRef, useState, type MouseEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMe, useProject, useProjectStage } from '../api/hooks'
import { AccessBar } from '../auth/AccessBar'
import { AiBadge } from '../auth/AiBadge'
import type { StepKey } from '../api/client'
import { STEPS } from './nav'
import { StepNav, type StepItem } from './StepNav'
import { Logo } from './Logo'
import { SiteFooter } from './SiteFooter'
import { SpendBanner } from './SpendBanner'
import { useTour } from '../tour/tourContext'
import styles from './AppShell.module.scss'
import brand from '../../brand/brand.json'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// Two navigation levels: a dark header with the app's areas (a dropdown on narrow screens), and inside a project a light
// strip of that project's steps. Links carry data-label so tests and scripts find them by name, not by their markup.
export function AppShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const tour = useTour()
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

  // Admin (the /settings pages) is for owners and editors; a viewer does not see it in the menu at all.
  const me = useMe()
  const canSettings = me.data?.role === 'owner' || me.data?.role === 'editor'
  const areas = [
    { to: '/insights/themes', label: 'Platform Insights', active: insights, icon: Analytics },
    { to: '/projects', label: 'Product Funnel', active: !insights && !settings, icon: Filter },
    ...(canSettings ? [{ to: '/settings/categories', label: 'Admin', active: settings, icon: SettingsIcon }] : []),
  ]
  const current = areas.find((a) => a.active) ?? areas[0]
  // The prototype gallery lives elsewhere: it opens in its own tab. Its address is a brand setting; with none, the link is not shown.
  const gallery = brand.galleryUrl as string | undefined
  // The decision guides are another place outside the app, set the same way and shown under the gallery.
  const decisionGuides = brand.decisionGuidesUrl as string | undefined

  return (
    <div className={styles.shell} ref={shell}>
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
          {decisionGuides && (
            <a href={decisionGuides} data-label="Decision Guides" target="_blank" rel="noopener noreferrer" className={cx(styles.area, styles.areaExternal)}>
              <Launch size={20} aria-hidden />
              Decision Guides
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
              {decisionGuides && (
                <a href={decisionGuides} role="menuitem" target="_blank" rel="noopener noreferrer" className={styles.menuItem}>
                  Decision Guides
                </a>
              )}
            </div>
          )}
        </div>
        <div className={styles.aiBadge}>
          <AiBadge />
        </div>
        <Button kind="ghost" size="sm" className={styles.tourLink} renderIcon={Help} data-testid="take-a-tour" onClick={tour.openWelcome}>
          Take a tour
        </Button>
        <div className={styles.access}>
          <AccessBar />
        </div>
      </header>

      {hasPanel && (
        <div className={styles.context} data-context>
          <div className={styles.contextInner}>
            <a href="/projects" data-label="All projects" className={styles.back} onClick={go('/projects')}>
              <ChevronLeft size={16} aria-hidden />
              All projects
            </a>
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
