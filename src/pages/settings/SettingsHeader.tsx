import { Button } from '@carbon/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMe } from '../../api/hooks'
import { SETTINGS_SECTIONS } from '../../shell/nav'
import { PageHero } from '../../shell/PageHero'
import styles from '../insights/InsightsHeader.module.scss'

// The title above every Settings screen, with the switch between the kinds of settings. Editors see Experience Categories only; the
// App Status and Members tabs are for owners.
export function SettingsHeader() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const me = useMe()
  const sections = SETTINGS_SECTIONS.filter((s) => s.key === 'categories' || me.data?.role === 'owner')
  const current = sections.findIndex((s) => pathname === `/settings/${s.key}`)
  return (
    <PageHero title="Settings" description="How this workspace is set up: its experience categories, how the app is running, and who can use it" glow="left">
      <nav className={styles.switch} aria-label="Settings sections">
        {sections.map((s, i) => (
          <Button key={s.key} kind={i === current ? 'primary' : 'ghost'} size="sm" data-label={s.label} data-current={i === current} aria-current={i === current ? 'page' : undefined} onClick={() => navigate(`/settings/${s.key}`)}>
            {s.label}
          </Button>
        ))}
      </nav>
    </PageHero>
  )
}
