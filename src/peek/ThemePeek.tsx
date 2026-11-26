import { ArrowRight } from '@carbon/icons-react'
import { ProgressBar, Tag } from '@carbon/react'
import { Link } from 'react-router-dom'
import { useInsightsThemes } from '../api/hooks'
import panel from '../components/PanelParts.module.scss'
import { RightPanel } from '../components/RightPanel'
import { SkeletonCard, SkeletonRegion } from '../components/Skeletons'
import { RecommendationBlock, WhereFromBlock } from '../pages/insights/ThemeBlocks'
import { CategoryBadge } from '../pages/themes/CategoryBadge'
import { ORIGIN_LABEL, STATUS } from '../pages/insights/labels'
import insights from '../pages/insights/InsightThemesView.module.scss'
import styles from './Peek.module.scss'
import { peekHref } from './targets'
import { useLast } from './useLast'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// A theme from "Themes across projects", scaled down: what a row shows when it is open, read only, with the way to the full row at the bottom.
export function ThemePeek({ id, onClose }: { id: string | null; onClose: () => void }) {
  const shown = useLast(id)
  const themes = useInsightsThemes(!!shown)
  const overview = themes.data
  const t = overview?.themes.find((x) => x.id === shown)
  return (
    <RightPanel open={!!id} heading={t?.title ?? 'Theme'} label="Theme" onClose={onClose}>
      {shown && (
        <div className={panel.body} data-testid="peek-theme">
          <div className={panel.scroll}>
            {themes.isPending && (
              <SkeletonRegion label="Loading the theme">
                <SkeletonCard lines={3} headingWidth="40%" />
              </SkeletonRegion>
            )}
            {!themes.isPending && !t && <p className={panel.help}>This theme is not available to you, or it no longer exists.</p>}
            {t && overview && (
              <>
                <section className={panel.section}>
                  <div className={styles.chips}>
                    <CategoryBadge category={t.category} />
                    <Tag size="sm" type="gray">{ORIGIN_LABEL[t.origin]}</Tag>
                    <Tag size="sm" type="gray">{STATUS[t.status].label}</Tag>
                  </div>
                  <p className={styles.facts}>
                    {t.participantCount} of {overview.totalParticipants} participants <span className={styles.muted}>· {plural(t.projectCount, 'project')}</span>
                  </p>
                  <ProgressBar label={`${t.title}: participants`} hideLabel size="small" value={t.participantCount} max={Math.max(overview.totalParticipants, 1)} />
                </section>
                <section className={panel.section}>
                  <RecommendationBlock theme={t} overview={overview} />
                  <WhereFromBlock theme={t} overview={overview} />
                  <section aria-label="Theme summary">
                    <h3 className={insights.label}>Theme summary</h3>
                    <p className={insights.text}>{t.summary ?? 'No summary yet.'}</p>
                  </section>
                </section>
              </>
            )}
          </div>
          <div className={panel.actions}>
            <Link className={styles.more} to={peekHref({ kind: 'theme', id: shown })} data-testid="peek-more">
              View details in Signal Flow
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </RightPanel>
  )
}
