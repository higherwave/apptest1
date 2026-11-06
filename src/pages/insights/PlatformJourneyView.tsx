import { Add, Edit } from '@carbon/icons-react'
import { Button, Dropdown, InlineNotification, Loading } from '@carbon/react'
import type { ReactNode } from 'react'
import type { PlatformJourney, Workflow } from '../../api/client'
import { CATEGORY_LABEL } from '../themes/themeEdits'
import { InsightsHeader } from './InsightsHeader'
import { STATUS } from './labels'
import { SentimentRow } from './SentimentRow'
import { journeyPersonas, WorkflowJourneyMap } from './WorkflowJourneyMap'
import map from '../themes/JourneyView.module.scss'
import styles from './PlatformJourneyView.module.scss'
import flow from './WorkflowJourney.module.scss'

export const ALL = 'all'

export type PlatformJourneyViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  journey?: PlatformJourney
  errorText?: string
  onOpenTheme: (id: string) => void
  /** The workflows to choose between, and the one showing (`ALL` is every study folded by stage name). */
  workflows: Workflow[]
  selected: string
  onSelect: (id: string) => void
  /** Owners and editors may change the blueprint. */
  canEdit: boolean
  onEdit: () => void
  onNew: () => void
  /** The Anchor CX example workflow is not in the workspace yet. */
  sampleMissing: boolean
  onAddSamples: () => void
  addingSamples: boolean
  persona: string | null
  onPersona: (key: string | null) => void
  /** The editor, when the workflow is being edited: it takes the place of the picker row and the map. */
  editor?: ReactNode
}

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

// A pain point's weight on the dot: what nobody has addressed shows heavier than what is on its way.
const weight = (opportunity: boolean, status: string) => (opportunity ? 'high' : status === 'not_addressed' ? 'medium' : 'low')

// Presentational: the platform journey. Pick a workflow to see it as a service blueprint (its stages and backstage, with the research of the projects on
// it laid over them, and a persona to trace), or "All studies" for every analysed project's journey map folded together by stage name. Read-only
// except the blueprint, which owners and editors edit in place. A theme opens on the Themes screen.
export function PlatformJourneyView(p: PlatformJourneyViewProps) {
  const { state, journey, errorText, onOpenTheme } = p
  const stages = journey?.stages ?? []
  const picks = [...p.workflows.map((w) => ({ id: w.id, label: `${w.name} · ${plural(w.projectCount, 'project')}` })), { id: ALL, label: 'All studies (by stage name)' }]
  const onWorkflow = p.selected !== ALL && !!journey?.workflow
  const personas = journey && onWorkflow ? journeyPersonas(journey) : []
  return (
    <div className={cx(map.page, styles.page)}>
      <InsightsHeader title="Platform Insights" description="The customer’s journey, stage by stage, with the teams and systems behind each stage" />
      {errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={errorText} />}

      {p.canEdit && !p.editor && (
        <div className={flow.newRow}>
          <Button kind="primary" size="md" renderIcon={Add} onClick={p.onNew}>
            New Workflow
          </Button>
        </div>
      )}

      {!p.editor && p.workflows.length > 0 && (
        <div className={flow.toolbar}>
          <Dropdown
            id="workflow-picker"
            titleText="Workflow"
            label="Choose a workflow"
            size="md"
            className={flow.picker}
            items={picks}
            itemToString={(i) => i?.label ?? ''}
            selectedItem={picks.find((i) => i.id === p.selected)}
            onChange={({ selectedItem }) => selectedItem && p.onSelect(selectedItem.id)}
          />
          {p.canEdit && (
            <div className={flow.actions}>
              {p.sampleMissing && (
                <Button kind="ghost" size="md" disabled={p.addingSamples} onClick={p.onAddSamples}>
                  {p.addingSamples ? 'Adding…' : 'Add the Anchor CX example'}
                </Button>
              )}
              {onWorkflow && (
                <Button kind="tertiary" size="md" renderIcon={Edit} onClick={p.onEdit}>
                  Edit Workflow
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {p.editor}

      {!p.editor && state === 'loading' && <Loading small withOverlay={false} description="Loading the journey" />}
      {!p.editor && p.workflows.length === 0 && state !== 'loading' && p.canEdit && (
        <div className={flow.emptyBox}>
          <p className={styles.muted}>
            A workflow is the blueprint of one app or feature: its stages, and the teams, systems and processes that work behind each one. Edit it once here and every project on it shows it.
          </p>
          <Button kind="primary" size="md" disabled={p.addingSamples} onClick={p.onAddSamples}>
            {p.addingSamples ? 'Adding…' : 'Add the Anchor CX example'}
          </Button>
        </div>
      )}
      {!p.editor && state === 'empty' && p.selected === ALL && <p className={styles.muted}>No journey yet. Analyze a project’s transcripts and its journey map is folded in here.</p>}

      {!p.editor && onWorkflow && state === 'ready' && journey?.workflow && (
        <>
          <p className={flow.pageNote}>
            {journey.workflow.description ? `${journey.workflow.description} ` : ''}
            {journey.workflow.projects === 0
              ? 'No project is on this workflow yet: on a project’s Journey Map, choose this workflow to lay its research over the blueprint.'
              : `Research from ${plural(journey.workflow.projects, 'project')} on this workflow.`}
          </p>
          {personas.length > 0 && (
            <div className={flow.trace} role="group" aria-label="Trace a persona">
              <span className={flow.traceLabel}>Trace a persona</span>
              {personas.map((x) => (
                <Button key={x.key} kind={p.persona === x.key ? 'primary' : 'tertiary'} size="sm" aria-pressed={p.persona === x.key} data-testid={`trace-${x.key}`} onClick={() => p.onPersona(p.persona === x.key ? null : x.key)}>
                  {x.name}
                </Button>
              ))}
              {p.persona && (
                <Button kind="ghost" size="sm" onClick={() => p.onPersona(null)}>
                  Clear
                </Button>
              )}
            </div>
          )}
          <WorkflowJourneyMap journey={journey} persona={p.persona} onOpenTheme={onOpenTheme} />
        </>
      )}

      {!p.editor && !onWorkflow && state === 'ready' && journey && (
        <>
          <p className={styles.muted}>
            Folded together from {plural(journey.projectCount, 'project')}. A theme sits in the stage most studies placed it in.
          </p>
          <div className={map.scroll}>
            <div className={map.map} data-columns={stages.length}>
              <div className={map.row}>
                <div className={map.corner} />
                {stages.map((s, i) => (
                  <div key={s.name} className={map.stageHead} data-testid={`journey-stage-${i}`}>
                    <span className={map.stageNumber}>Stage {i + 1}</span>
                    <span className={map.stageName}>{s.name}</span>
                  </div>
                ))}
              </div>

              <div className={map.row}>
                <div className={map.rowLabel}>Themes</div>
                {stages.map((s) => (
                  <section key={s.name} className={cx(map.cell, map.themesCell)} aria-label={`${s.name}: ${s.themes.length} themes`}>
                    {s.themes.map((t) => (
                      <article key={t.id} className={map.card} data-category={t.category} title={CATEGORY_LABEL[t.category]}>
                        <div className={map.cardTop}>
                          <Button kind="ghost" size="sm" className={styles.themeLink} onClick={() => onOpenTheme(t.id)}>
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
                {stages.map((s) => {
                  const pains = s.themes.filter((t) => t.category === 'pain_point')
                  return (
                    <div key={s.name} className={map.cell}>
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

              <SentimentRow stages={stages} />

              <div className={map.row}>
                <div className={map.rowLabel}>Opportunity</div>
                {stages.map((s) => {
                  const open = s.themes.filter((t) => t.opportunity)
                  const text = open.length ? `Address: ${open.map((t) => t.title).join('; ')}` : s.themes.length ? 'No open opportunities here.' : 'No themes mapped to this stage.'
                  return (
                    <div key={s.name} className={map.cell}>
                      <p className={open.length ? map.opportunity : map.none}>{text}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
