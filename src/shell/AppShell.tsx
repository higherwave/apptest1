import { Content, Header, HeaderName, SideNav, SideNavItems, SideNavLink } from '@carbon/react'
import type { MouseEvent } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useProjectStage } from '../api/hooks'
import { AccessBar } from '../auth/AccessBar'
import type { StepKey } from '../api/client'
import { INSIGHT_SECTIONS, STEPS, STEP_GROUPS } from './nav'
import styles from './AppShell.module.scss'

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
  // The server says which steps are open; until it answers, none are shown as locked.
  const stage = useProjectStage(projectId ?? undefined)

  return (
    <>
      <Header aria-label="Signal Flow">
        <HeaderName href="/projects" prefix="" onClick={go('/projects')}>
          Signal Flow
        </HeaderName>
      </Header>

      <SideNav aria-label="Navigation" isFixedNav expanded isChildOfHeader={false}>
        <SideNavItems>
          <SideNavLink href="/projects" isActive={!insights} onClick={go('/projects')}>
            Research Projects
          </SideNavLink>
          <SideNavLink href="/insights/themes" isActive={insights} onClick={go('/insights/themes')}>
            Platform Insights
          </SideNavLink>
        </SideNavItems>

        {projectId &&
          STEP_GROUPS.map((group) => (
            <SideNavItems key={group}>
              <p className={styles.groupLabel}>{group}</p>
              {STEPS.filter((s) => s.group === group).map((s) => {
                const tab = stage.data?.tabs[s.key as StepKey]
                const locked = tab ? !tab.enabled : false
                return (
                  <SideNavLink
                    key={s.key}
                    href={`/projects/${projectId}/${s.key}`}
                    isActive={project?.[2] === s.key}
                    aria-disabled={locked || undefined}
                    title={locked ? (tab?.hint ?? undefined) : undefined}
                    className={locked ? styles.locked : undefined}
                    onClick={locked ? (e: MouseEvent) => e.preventDefault() : go(`/projects/${projectId}/${s.key}`)}
                  >
                    {s.label}
                  </SideNavLink>
                )
              })}
            </SideNavItems>
          ))}

        {insights && (
          <SideNavItems>
            <p className={styles.groupLabel}>Insights</p>
            {INSIGHT_SECTIONS.map((s) => (
              <SideNavLink key={s.key} href={`/insights/${s.key}`} isActive={pathname === `/insights/${s.key}`} onClick={go(`/insights/${s.key}`)}>
                {s.label}
              </SideNavLink>
            ))}
          </SideNavItems>
        )}
      </SideNav>

      <Content className={styles.content}>
        <AccessBar />
        <Outlet />
      </Content>
    </>
  )
}
