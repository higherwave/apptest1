import { Button } from '@carbon/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { SETTINGS_SECTIONS } from '../../shell/nav'
import { PageHero } from '../../shell/PageHero'
import styles from '../insights/InsightsHeader.module.scss'

// The title above every Settings screen, with the switch between the kinds of settings (one for now).
export function SettingsHeader({ title, description }: { title: string; description: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const current = Math.max(0, SETTINGS_SECTIONS.findIndex((s) => pathname === `/settings/${s.key}`))
  return (
    <PageHero title={title} description={description} glow="left">
      <nav className={styles.switch} aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((s, i) => (
          <Button key={s.key} kind={i === current ? 'primary' : 'ghost'} size="sm" data-label={s.label} data-current={i === current} aria-current={i === current ? 'page' : undefined} onClick={() => navigate(`/settings/${s.key}`)}>
            {s.label}
          </Button>
        ))}
      </nav>
    </PageHero>
  )
}
