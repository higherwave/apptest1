import { Button } from '@carbon/react'
import type { PlatformJourney } from '../../api/client'
import { CATEGORY_LABEL } from '../themes/themeEdits'
import { STATUS } from './labels'
import { SentimentRow } from './SentimentRow'
import map from '../themes/JourneyView.module.scss'
import legacy from './PlatformJourneyView.module.scss'
import styles from './WorkflowJourney.module.scss'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`
const weight = (opportunity: boolean, status: string) => (opportunity ? 'high' : status === 'not_addressed' ? 'medium' : 'low')

/** The people who appear anywhere on the journey, by name. */
export function journeyPersonas(journey: PlatformJourney): { key: string; name: string }[] {
  const seen = new Map<string, string>()
  for (const s of journey.stages) for (const p of s.personas ?? []) seen.set(p.key, p.name)
  return [...seen].map(([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name))
}

export type WorkflowJourneyMapProps = { journey: PlatformJourney; persona: string | null; onOpenTheme: (id: string) => void }

// Presentational: one workflow as a service blueprint. The blueprint's own stages and what good looks like at each, the research of the projects on
// the workflow (themes, pain points, opportunity, sentiment), who is in each stage, and the backstage under it with its owners and the handoff out.
export function WorkflowJourneyMap({ journey, persona, onOpenTheme }: WorkflowJourneyMapProps) {
  const stages = journey.stages
  // With a persona traced, a stage they are not in fades back.
  const dim = (i: number) => !!persona && !(stages[i].personas ?? []).some((p) => p.key === persona)
  const fade = (i: number) => dim(i) && styles.dim
  return (
    <div className={map.scroll}>
      <div className={map.map} data-columns={stages.length} data-testid="workflow-map">
        <div className={map.row}>
          <div className={map.corner} />
          {stages.map((s, i) => (
            <div key={s.id ?? s.name} className={cx(map.stageHead, fade(i))} data-testid={`journey-stage-${i}`}>
              <span className={map.stageNumber}>Stage {i + 1}</span>
              <span className={map.stageName}>{s.name}</span>
            </div>
          ))}
        </div>

        <div className={map.row}>
          <div className={map.rowLabel}>Stage goal</div>
          {stages.map((s, i) => (
            <div key={s.id ?? s.name} className={cx(map.cell, fade(i))}>
              <div className={styles.field}>
                <p className={styles.fieldLabel}>What good looks like</p>
                <p className={s.good ? styles.fieldText : map.none}>{s.good ?? 'Not written yet'}</p>
              </div>
              <div className={styles.field}>
                <p className={styles.fieldLabel}>Signal to watch</p>
                <p className={s.signal ? styles.fieldText : map.none}>{s.signal ?? 'Not written yet'}</p>
              </div>
            </div>
          ))}
        </div>

        <div className={map.row}>
          <div className={map.rowLabel}>Themes</div>
          {stages.map((s, i) => (
            <section key={s.id ?? s.name} className={cx(map.cell, map.themesCell, fade(i))} aria-label={`${s.name}: ${s.themes.length} themes`}>
              {s.themes.length === 0 && <p className={map.none}>{s.projectCount === 0 ? 'No project mapped here' : 'No themes found here'}</p>}
              {s.themes.map((t) => (
                <article key={t.id} className={map.card} data-category={t.category} title={CATEGORY_LABEL[t.category]}>
                  <div className={map.cardTop}>
                    <Button kind="ghost" size="sm" className={legacy.themeLink} onClick={() => onOpenTheme(t.id)}>
                      {t.title}
                    </Button>
                  </div>
                  <p className={map.meta}>
                    {STATUS[t.status].label} · {t.participantCount}/{journey.totalParticipants}
                  </p>
                </article>
              ))}
            </section>
          ))}
        </div>

        <div className={cx(map.row, map.painRow)}>
          <div className={map.rowLabel}>Pain points</div>
          {stages.map((s, i) => {
            const pains = s.themes.filter((t) => t.category === 'pain_point')
            return (
              <div key={s.id ?? s.name} className={cx(map.cell, fade(i))}>
                {pains.length === 0 && <p className={map.none}>None reported</p>}
                {pains.map((t) => (
                  <div key={t.id} className={map.pain}>
                    <span className={map.dot} data-priority={weight(t.opportunity, t.status)} aria-hidden />
                    <div>
                      <p className={map.painTitle}>{t.title}</p>
                      <p className={map.meta}>
                        {t.participantCount} of {journey.totalParticipants} participants · {plural(t.projectCount, 'project')} · {STATUS[t.status].label}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div className={map.row}>
          <div className={map.rowLabel}>Opportunity</div>
          {stages.map((s, i) => {
            const open = s.themes.filter((t) => t.opportunity)
            const text = open.length ? `Address: ${open.map((t) => t.title).join('; ')}` : s.themes.length ? 'No open opportunities here.' : 'No themes mapped to this stage.'
            return (
              <div key={s.id ?? s.name} className={cx(map.cell, fade(i))}>
                <p className={open.length ? map.opportunity : map.none}>{text}</p>
              </div>
            )
          })}
        </div>

        <SentimentRow stages={stages} />

        <div className={cx(map.row, styles.personaRow)} data-testid="persona-row">
          <div className={map.rowLabel}>Personas</div>
          {stages.map((s, i) => {
            const people = s.personas ?? []
            return (
              <div key={s.id ?? s.name} className={cx(map.cell, fade(i))}>
                {people.length === 0 && <p className={map.none}>Nobody mapped here</p>}
                {people.map((p) => (
                  <div key={p.key} className={styles.persona} data-traced={persona === p.key}>
                    <p className={styles.fieldText}>
                      {p.name} · {plural(p.participantCount, 'person', 'people')}
                    </p>
                    <p className={map.meta}>Raised: {p.doing}</p>
                  </div>
                ))}
              </div>
            )
          })}
        </div>

        <div className={cx(map.row, map.backstageRow)} data-testid="blueprint-backstage-row">
          <div className={map.rowLabel}>
            Backstage
            <span className={map.simulated}>From the blueprint</span>
          </div>
          {stages.map((s, i) => (
            <div key={s.id ?? s.name} className={cx(map.cell, fade(i))}>
              {(s.backstage ?? []).length === 0 && <p className={map.none}>Nothing added yet</p>}
              {(s.backstage ?? []).map((b) => (
                <div key={b.id} className={styles.backstageEntry}>
                  <span className={map.backstageKind}>{b.kind}</span>
                  <p className={map.backstageText}>{b.name}</p>
                  {b.owner && <p className={styles.owner}>Owner: {b.owner}</p>}
                </div>
              ))}
              {s.handoff && (
                <div className={styles.handoff}>
                  <p className={styles.fieldLabel}>Handoff</p>
                  <p className={styles.fieldText}>{s.handoff}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
