import { ChevronLeft } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useCallback, useEffect, useRef, type MouseEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAreaProposals, useMe, useProject, useProjectStage, useSetup } from '../api/hooks'
import type { StepKey } from '../api/client'
import { ADMIN_GROUPS, STEP_GROUPS, STEPS, stepStates } from './nav'
import { SectionNav, type NavGroup } from './SectionNav'
import { TitleBar } from './TitleBar'
import { AppHeader } from './AppHeader'
import { SiteFooter } from './SiteFooter'
import { SpendBanner } from './SpendBanner'
import { StatusTag } from './StatusTag'
import { noteVisit } from '../resume/recent'
import { useReportTimeZone } from './useReportTimeZone'
import styles from './AppShell.module.scss'

// Two navigation levels: the dark app header (AppHeader), and inside a project or Admin a title bar (what you are in, with the ribbons) and under it a row of that place's menu
// (SectionNav: the steps of a project, the views of Admin; one button on a phone). Links carry data-label so tests and scripts find them by name, not by their markup.
export function AppShell() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const me = useMe()
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
  const admin = pathname.startsWith('/settings')
  // The server says which steps are open; until it answers, none are shown as locked.
  const stage = useProjectStage(projectId ?? undefined)
  const projectDetail = useProject(projectId ?? undefined)
  const hasPanel = !!projectId || creating

  // The steps as the menu shows them: open, locked (with the reason) and which one is showing.
  const open = STEPS.map((s) => {
    const tab = projectId ? stage.data?.tabs[s.key as StepKey] : undefined
    return creating ? s.key === 'plan' : tab ? tab.enabled : true
  })
  const { states } = stepStates(open)
  const stepGroups: NavGroup[] = STEP_GROUPS.map((group) => ({
    label: group,
    items: STEPS.flatMap((s, i) => {
      if (s.group !== group) return []
      const tab = projectId ? stage.data?.tabs[s.key as StepKey] : undefined
      return [
        {
          key: s.key,
          label: s.label,
          to: creating ? '/projects/new' : `/projects/${projectId}/${s.key}`,
          active: creating ? s.key === 'plan' : project?.[2] === s.key,
          locked: creating ? s.key !== 'plan' : tab ? !tab.enabled : false,
          state: states[i],
          hint: creating ? 'Create the project first' : (tab?.hint ?? undefined),
        },
      ]
    }),
  }))

  // Admin: the groups this person may open. Editors have Experience Categories and Communication; owners have them all (Pulse only while its preview is on).
  const owner = me.data?.role === 'owner'
  const setup = useSetup(admin && owner)
  const proposals = useAreaProposals(admin && !!me.data)
  const section = pathname.match(/^\/settings\/([^/]+)/)?.[1]
  const asked = new URLSearchParams(search).get('tab')
  const adminGroups: NavGroup[] = ADMIN_GROUPS.filter((g) => (!g.ownerOnly || owner) && (!g.needsPulse || !!me.data?.features.pulse)).map((g) => ({
    label: g.label,
    items: g.items.map((i) => {
      const sameSection = g.items.filter((x) => x.section === i.section)
      // A section's first view is the one open when the address names none (or names one that does not exist).
      const openTab = sameSection.some((x) => x.tab === asked) ? asked : sameSection[0].tab
      const matches = i.key === 'matches' && (proposals.data?.length ?? 0) > 0 ? ` · ${proposals.data!.length}` : ''
      return { key: i.key, label: `${i.label}${matches}`, to: `/settings/${i.section}${i.tab ? `?tab=${i.tab}` : ''}`, active: section === i.section && (!i.tab || i.tab === openTab), testId: i.testId }
    }),
  }))

  return (
    <div className={styles.shell} ref={shell}>
      <SpendBanner onHeight={onBanner} />
      <AppHeader />

      <div className={styles.stage}>
        {hasPanel && (
          <>
            <TitleBar data-context>
              <a href="/projects" data-label="All projects" aria-label="All projects" title="All projects" className={styles.back} onClick={go('/projects')}>
                <ChevronLeft size={20} aria-hidden />
              </a>
              <span className={styles.projectName}>{creating ? 'New project' : (projectDetail.data?.name ?? '')}</span>
              {projectDetail.data && !creating && <StatusTag status={projectDetail.data.status} />}
            </TitleBar>
            <SectionNav label="Project steps" groups={stepGroups} onGo={navigate} dataNav />
          </>
        )}
        {admin && (
          <>
            <TitleBar data-admin-title>
              <h1 className={styles.adminTitle}>Admin</h1>
              {owner && setup.data && !setup.data.complete && (
                <Button kind="tertiary" size="sm" className={styles.setup} onClick={() => navigate('/setup')} data-testid="open-setup">
                  Set up your workspace · {setup.data.done} of {setup.data.total}
                </Button>
              )}
            </TitleBar>
            <SectionNav label="Admin sections" groups={adminGroups} onGo={navigate} />
          </>
        )}
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
