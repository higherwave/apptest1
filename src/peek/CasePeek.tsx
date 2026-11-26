import { ArrowRight } from '@carbon/icons-react'
import { Tag } from '@carbon/react'
import { Link } from 'react-router-dom'
import { useCaseBriefs } from '../api/hooks'
import panel from '../components/PanelParts.module.scss'
import { RightPanel } from '../components/RightPanel'
import { SkeletonCard, SkeletonRegion } from '../components/Skeletons'
import styles from './Peek.module.scss'
import { peekHref } from './targets'
import { useLast } from './useLast'

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const THEMES = 3
const DECISIONS = 4

// A project's case study, scaled down: how it turned out, the problem, what was decided and what was measured. The id is the project's.
export function CasePeek({ id, onClose }: { id: string | null; onClose: () => void }) {
  const shown = useLast(id)
  const briefs = useCaseBriefs(!!shown)
  const b = briefs.data?.find((x) => x.projectId === shown)
  return (
    <RightPanel open={!!id} heading={b?.projectName ?? 'Case study'} label="Case study" onClose={onClose}>
      {shown && (
        <div className={panel.body} data-testid="peek-case">
          <div className={panel.scroll}>
            {briefs.isPending && (
              <SkeletonRegion label="Loading the case study">
                <SkeletonCard lines={3} headingWidth="40%" />
              </SkeletonRegion>
            )}
            {!briefs.isPending && !b && <p className={panel.help}>This case study is not available to you, or it no longer exists.</p>}
            {b && (
              <>
                <section className={panel.section}>
                  <div className={styles.chips}>
                    <Tag size="sm" type="green">Case study</Tag>
                  </div>
                  {b.outcome && <p className={styles.facts}>{b.outcome}</p>}
                  <p className={`${styles.facts} ${styles.muted}`}>{b.template ?? 'Research study'} · {plural(b.sessions, 'session')} · {plural(b.participants, 'participant')}</p>
                </section>
                <section className={panel.section} aria-label="The problem">
                  <h3 className={panel.heading}>The problem</h3>
                  {b.problem.length === 0 && <p className={panel.help}>No themes yet.</p>}
                  <ul className={styles.steps}>
                    {b.problem.slice(0, THEMES).map((t) => (
                      <li key={t.title} className={styles.step}>
                        <span className={styles.stepName}>{t.title}</span>
                        <span className={styles.stepState}>{t.participantCount} of {t.totalParticipants} participants</span>
                      </li>
                    ))}
                  </ul>
                  {b.problem.length > THEMES && <p className={panel.small}>{b.problem.length - THEMES} more on the full page.</p>}
                </section>
                <section className={panel.section} aria-label="What we decided">
                  <h3 className={panel.heading}>What we decided</h3>
                  {!b.decisions && <p className={panel.help}>Nothing yet: the requirements are not published.</p>}
                  <ul className={styles.steps}>
                    {b.decisions?.requirements.slice(0, DECISIONS).map((r) => (
                      <li key={r.key} className={styles.step}>
                        <span className={styles.stepName}>{r.key} {r.title}</span>
                        <span className={styles.stepState}>{r.priority} priority</span>
                      </li>
                    ))}
                  </ul>
                  {b.decisions && b.decisions.requirements.length > DECISIONS && <p className={panel.small}>{b.decisions.requirements.length - DECISIONS} more on the full page.</p>}
                </section>
                <section className={panel.section} aria-label="What happened">
                  <h3 className={panel.heading}>What happened</h3>
                  {(!b.results || b.results.items.length === 0) && <p className={panel.help}>Nothing has been measured yet.</p>}
                  <ul className={styles.steps}>
                    {b.results?.items.map((r) => (
                      <li key={r.key} className={styles.step}>
                        <span className={styles.stepName}>{r.key} {r.metric ?? r.title}</span>
                        <span className={styles.stepState}>
                          {[r.baseline ? `Before ${r.baseline}` : null, r.target ? `Goal ${r.target}` : null, r.latest ? `Latest (${r.latest.on}): ${r.latest.value}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              </>
            )}
          </div>
          <div className={panel.actions}>
            <Link className={styles.more} to={peekHref({ kind: 'case', id: shown })} data-testid="peek-more">
              View details in Signal Flow
              <ArrowRight size={16} aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </RightPanel>
  )
}
