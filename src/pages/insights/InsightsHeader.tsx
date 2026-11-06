import { Button } from '@carbon/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCaseBriefs, useCaseStudies, useInsightsThemes } from '../../api/hooks'
import { INSIGHT_SECTIONS } from '../../shell/nav'
import { PageHero } from '../../shell/PageHero'
import styles from './InsightsHeader.module.scss'

// The title and description above every Platform Insights screen, with the switch between its sections.
export function InsightsHeader({ title, description }: { title: string; description: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const themes = useInsightsThemes()
  const cases = useCaseStudies()
  const briefs = useCaseBriefs()
  // The page lists a row for each project with a shipped success and one for each case study written by hand: the count is both, so it matches the rows.
  const counts: Record<string, number | undefined> = {
    themes: themes.data?.themes.length,
    'case-studies': cases.data && briefs.data ? cases.data.length + briefs.data.length : undefined,
  }
  const current = Math.max(0, INSIGHT_SECTIONS.findIndex((s) => pathname === `/insights/${s.key}`))
  return (
    <PageHero title={title} description={description} glow="left">
      <nav className={styles.switch} aria-label="Platform Insights sections">
        {INSIGHT_SECTIONS.map((s, i) => (
          <Button key={s.key} kind={i === current ? 'primary' : 'ghost'} size="sm" data-label={s.label} data-current={i === current} aria-current={i === current ? 'page' : undefined} onClick={() => navigate(`/insights/${s.key}`)}>
            {s.label}
            {counts[s.key] !== undefined && <span className={styles.count}> · {counts[s.key]}</span>}
          </Button>
        ))}
      </nav>
    </PageHero>
  )
}
