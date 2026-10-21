import { Button, Tag } from '@carbon/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCaseStudies, useInsightsThemes } from '../../api/hooks'
import { INSIGHT_SECTIONS } from '../../shell/nav'
import styles from './InsightsHeader.module.scss'

// The title and description above every Platform Insights screen, with the tabs between its sections.
export function InsightsHeader({ title, description }: { title: string; description: string }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const themes = useInsightsThemes()
  const cases = useCaseStudies()
  const counts: Record<string, number | undefined> = { themes: themes.data?.themes.length, 'case-studies': cases.data?.length }
  const current = Math.max(0, INSIGHT_SECTIONS.findIndex((s) => pathname === `/insights/${s.key}`))
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.description}>{description}</p>
      </div>
      <nav className={styles.tabs} aria-label="Platform Insights sections">
        {INSIGHT_SECTIONS.map((s, i) => (
          <Button key={s.key} kind="ghost" size="md" className={styles.tabButton} data-label={s.label} data-current={i === current} aria-current={i === current ? 'page' : undefined} onClick={() => navigate(`/insights/${s.key}`)}>
            <span className={styles.tab}>
              {s.label}
              {counts[s.key] !== undefined && (
                <Tag size="sm" type={i === current ? 'high-contrast' : 'gray'}>
                  {counts[s.key]}
                </Tag>
              )}
            </span>
          </Button>
        ))}
      </nav>
    </header>
  )
}
