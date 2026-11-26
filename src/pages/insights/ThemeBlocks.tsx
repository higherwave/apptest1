import type { InsightsThemes } from '../../api/client'
import { teamConversations } from './labels'
import styles from './InsightThemesView.module.scss'

export type ThemeRow = InsightsThemes['themes'][number]
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// Two parts of a theme's row that the page and the quick-reference drawer both show, so they cannot drift apart: what to do about it, and where it comes from.
export function RecommendationBlock({ theme: t, overview }: { theme: ThemeRow; overview: InsightsThemes }) {
  const recs = overview.recommendations.filter((r) => r.themes.some((x) => x.id === t.id))
  return (
    <section aria-label="Recommendation" className={styles.banner} data-testid={`recommendation-${t.id}`}>
      <h3 className={styles.label}>Recommendation</h3>
      {recs.length === 0 ? (
        <p className={styles.text}>{t.opportunity ? `An opportunity: raised in ${plural(t.projectCount, 'project')} and no requirement addresses it yet.` : 'No recommendation yet.'}</p>
      ) : (
        recs.map((r) => (
          <p key={r.id} className={styles.text}>
            <strong>{r.title}</strong>
            {r.why ? ` ${r.why}` : ''}
          </p>
        ))
      )}
    </section>
  )
}

export function WhereFromBlock({ theme: t, overview }: { theme: ThemeRow; overview: InsightsThemes }) {
  return (
    <section aria-label="Where this comes from">
      <h3 className={styles.label}>Where this comes from</h3>
      <p className={styles.text}>
        {t.origin === 'team'
          ? `Heard only in ${teamConversations(t.teamSessions)}, so no customer has raised it in a study yet and it does not count toward reach.`
          : `Raised by ${t.participantCount} of ${overview.totalParticipants} participants across ${t.projectCount} of ${plural(overview.projects.length, 'project')}.${t.teamSessions > 0 ? ` Also discussed in ${teamConversations(t.teamSessions)}, which confirms it but does not count toward reach.` : ''}`}
      </p>
      {t.aliases.length > 0 && <p className={styles.text}>Also known as: {t.aliases.join('; ')}.</p>}
    </section>
  )
}
