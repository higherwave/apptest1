import { ArrowRight } from '@carbon/icons-react'
import { Button, Dropdown, InlineNotification, Loading, OverflowMenu, OverflowMenuItem } from '@carbon/react'
import { useState } from 'react'
import type { ProjectBlueprint, ProjectDetail, Theme, ThemePatch, Workflow } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { stageBackstage, stageFlow, stageOpportunity, stagePainPoints } from './journeyMap'
import { CATEGORY_LABEL, LEVEL_LABEL, type Level } from './themeEdits'
import styles from './JourneyView.module.scss'

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

export type JourneyViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  project?: ProjectDetail
  stages: { position: number; name: string }[]
  themes: Theme[]
  canEdit: boolean
  pending: ReadonlySet<string>
  errorText?: string
  onEdit: (theme: Theme, patch: ThemePatch) => void
  onGoTranscripts: () => void
  /** The workflow the project is on (the service blueprint) and the stages mapped to it; undefined until loaded. */
  blueprint?: ProjectBlueprint
  workflows: Workflow[]
  onSetWorkflow: (workflowId: string | null) => void
  onMapStage: (position: number, workflowStageId: string | null) => void
}

const NONE = { id: '', label: 'Not on a workflow' }

// Presentational: every theme laid out by journey stage, at the stage the analysis suggested unless the person moved it. A theme moves by dragging it to a stage, or with its
// menu, which is the way to do it without a mouse.
export function JourneyView({ state, project, stages, themes, canEdit, pending, errorText, onEdit, onGoTranscripts, blueprint, workflows, onSetWorkflow, onMapStage }: JourneyViewProps) {
  const [over, setOver] = useState<number | null>(null)
  const stageOf = (t: Theme) => t.stagePosition ?? 0
  const drop = (position: number, id: string) => {
    const theme = themes.find((t) => t.id === id)
    if (theme && canEdit && stageOf(theme) !== position) onEdit(theme, { stagePosition: position })
  }

  return (
    <div className={styles.page}>
      {project && <ProjectHeader title="Journey Map" description="Where each theme falls along the customer journey. Drag a theme to another stage to move it." />}

      {state === 'ready' && blueprint && (canEdit || blueprint.workflow) && (
        <div className={styles.workflowBar}>
          {canEdit ? (
            <Dropdown
              id="project-workflow"
              titleText="Workflow"
              label="Choose a workflow"
              size="md"
              className={styles.workflowPicker}
              items={[NONE, ...workflows.map((w) => ({ id: w.id, label: w.name }))]}
              itemToString={(i) => i?.label ?? ''}
              selectedItem={blueprint.workflow ? { id: blueprint.workflow.id, label: blueprint.workflow.name } : NONE}
              onChange={({ selectedItem }) => selectedItem && selectedItem.id !== (blueprint.workflow?.id ?? '') && onSetWorkflow(selectedItem.id || null)}
            />
          ) : (
            <p className={styles.workflowNote}>Workflow: {blueprint.workflow?.name}</p>
          )}
          <p className={styles.workflowNote}>
            {blueprint.workflow
              ? 'The Backstage row comes from this workflow’s blueprint, edited under Platform Insights > Workflows.'
              : workflows.length > 0
                ? 'Put this project on a workflow and the Backstage row shows its real teams, systems and owners.'
                : 'The Backstage row is simulated. Add a workflow under Platform Insights > Workflows to replace it with real teams, systems and owners.'}
          </p>
        </div>
      )}

      {state === 'loading' && <Loading small withOverlay={false} description="Loading the journey map" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Journey Map" subtitle={errorText} />}
      {state === 'empty' && (
        <div className={styles.empty}>
          <p>No themes yet. Add transcripts and run the analysis to find them.</p>
          <Button kind="secondary" onClick={onGoTranscripts}>
            Go to Transcripts
          </Button>
        </div>
      )}
      {errorText && state === 'ready' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Not saved" subtitle={errorText} />}

      {state === 'ready' && (
        <div className={styles.scroll}>
          <div className={styles.map} data-columns={stages.length}>
            <div className={styles.row}>
              <div className={styles.corner} />
              {stages.map((stage) => (
                <div key={stage.position} className={styles.stageHead}>
                  <span className={styles.stageNumber}>Stage {stage.position + 1}</span>
                  <span className={styles.stageName}>{stage.name}</span>
                </div>
              ))}
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>Themes</div>
              {stages.map((stage) => {
                const here = themes.filter((t) => stageOf(t) === stage.position)
                return (
                  <section
                    key={stage.position}
                    className={cx(styles.cell, styles.themesCell)}
                    data-over={over === stage.position}
                    aria-label={`${stage.name}: ${here.length} themes`}
                    onDragOver={(e) => {
                      if (!canEdit) return
                      e.preventDefault()
                      setOver(stage.position)
                    }}
                    onDragLeave={() => setOver(null)}
                    onDrop={(e) => {
                      e.preventDefault()
                      setOver(null)
                      drop(stage.position, e.dataTransfer.getData('text/plain'))
                    }}
                  >
                    {here.map((t) => (
                      <article
                        key={t.id}
                        className={styles.card}
                        data-category={t.category}
                        title={CATEGORY_LABEL[t.category]}
                        draggable={canEdit && !pending.has(t.id)}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                      >
                        <div className={styles.cardTop}>
                          <p className={styles.title}>{t.title}</p>
                          {canEdit && (
                            <OverflowMenu iconDescription={`Actions for ${t.title}`} flipped size="sm">
                              {stages
                                .filter((s) => s.position !== stageOf(t))
                                .map((s) => (
                                  <OverflowMenuItem key={s.position} itemText={`Move to ${s.name}`} onClick={() => onEdit(t, { stagePosition: s.position })} />
                                ))}
                            </OverflowMenu>
                          )}
                        </div>
                        <p className={styles.meta}>
                          {LEVEL_LABEL[t.priority as Level]} · {t.participantCount}/{t.totalParticipants}
                        </p>
                      </article>
                    ))}
                  </section>
                )
              })}
            </div>

            <div className={cx(styles.row, styles.painRow)}>
              <div className={styles.rowLabel}>Pain points</div>
              {stages.map((stage) => {
                const pains = stagePainPoints(themes.filter((t) => stageOf(t) === stage.position))
                return (
                  <div key={stage.position} className={styles.cell}>
                    {pains.length === 0 && <p className={styles.none}>None reported</p>}
                    {pains.map((t) => (
                      <div key={t.id} className={styles.pain}>
                        <span className={styles.dot} data-priority={t.priority} aria-hidden />
                        <div>
                          <p className={styles.painTitle}>{t.title}</p>
                          <p className={styles.meta}>
                            {t.participantCount} of {t.totalParticipants} participants · {LEVEL_LABEL[t.priority as Level]}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>

            <div className={styles.row}>
              <div className={styles.rowLabel}>Opportunity</div>
              {stages.map((stage) => {
                const opportunity = stageOpportunity(themes.filter((t) => stageOf(t) === stage.position))
                return (
                  <div key={stage.position} className={styles.cell}>
                    <p className={opportunity ? styles.opportunity : styles.none}>{opportunity ?? 'No themes mapped to this stage.'}</p>
                  </div>
                )
              })}
            </div>

            <div className={cx(styles.row, styles.flowRow)} data-testid="flow-row">
              <div className={styles.rowLabel}>
                User flow
                <span className={styles.simulated}>Simulated</span>
              </div>
              {stages.map((stage, i) => {
                const flow = stageFlow(stage.name, themes.filter((t) => stageOf(t) === stage.position), stages[i + 1]?.name ?? null)
                return (
                  <div key={stage.position} className={styles.cell}>
                    {flow.steps.length === 0 && <p className={styles.none}>Nothing to follow</p>}
                    {flow.steps.length > 0 && (
                      <>
                        {flow.sentiment && (
                          <p className={styles.feel} data-tone={flow.sentiment.toLowerCase()}>
                            {flow.sentiment} sentiment
                          </p>
                        )}
                        <ol className={styles.steps}>
                          {flow.steps.map((step, n) => (
                            <li key={step.kind + step.text} className={styles.step} data-kind={step.kind} data-tone={step.tone}>
                              <span className={styles.stepKind}>
                                {n + 1} · {step.kind}
                              </span>
                              <p className={styles.stepText}>{step.text}</p>
                              {step.note && <p className={styles.meta}>{step.note}</p>}
                            </li>
                          ))}
                        </ol>
                        <p className={styles.next}>
                          <ArrowRight size={16} aria-hidden />
                          {flow.next ? `Next: ${flow.next}` : 'End of the journey'}
                        </p>
                      </>
                    )}
                  </div>
                )
              })}
            </div>

            <div className={cx(styles.row, styles.backstageRow)} data-testid="backstage-row">
              <div className={styles.rowLabel}>
                Backstage
                <span className={styles.simulated}>{blueprint?.workflow ? `From ${blueprint.workflow.name}` : 'Simulated'}</span>
              </div>
              {stages.map((stage) => {
                const here = themes.filter((t) => stageOf(t) === stage.position)
                const mapped = blueprint?.workflow ? blueprint.stages.find((b) => b.position === stage.position) : undefined
                if (blueprint?.workflow) {
                  const flowStages = workflows.find((w) => w.id === blueprint.workflow!.id)?.stages ?? []
                  return (
                    <div key={stage.position} className={styles.cell}>
                      {mapped?.workflowStage ? (
                        <>
                          {mapped.workflowStage.backstage.length === 0 && <p className={styles.none}>Nothing added to {mapped.workflowStage.name} yet</p>}
                          {mapped.workflowStage.backstage.map((b) => (
                            <div key={b.id} className={styles.backstageItem}>
                              <span className={styles.backstageKind}>{b.kind}</span>
                              <p className={styles.backstageText}>{b.name}</p>
                              {b.owner && <p className={styles.meta}>Owner: {b.owner}</p>}
                            </div>
                          ))}
                          {mapped.workflowStage.handoff && (
                            <div className={styles.backstageItem}>
                              <span className={styles.backstageKind}>Handoff</span>
                              <p className={styles.backstageText}>{mapped.workflowStage.handoff}</p>
                            </div>
                          )}
                          {canEdit && (
                            <Button kind="ghost" size="sm" className={styles.unmap} onClick={() => onMapStage(stage.position, null)}>
                              Unmap from {mapped.workflowStage.name}
                            </Button>
                          )}
                        </>
                      ) : (
                        <>
                          <p className={styles.none}>Not mapped to a stage of this workflow</p>
                          {canEdit && (
                            <Dropdown
                              id={`map-stage-${stage.position}`}
                              titleText={`Workflow stage for ${stage.name}`}
                              hideLabel
                              label="Map to a stage"
                              size="sm"
                              items={flowStages.map((f) => ({ id: f.id, label: f.name }))}
                              itemToString={(i) => i?.label ?? ''}
                              selectedItem={null}
                              onChange={({ selectedItem }) => selectedItem && onMapStage(stage.position, selectedItem.id)}
                            />
                          )}
                        </>
                      )}
                    </div>
                  )
                }
                const items = stageBackstage(stage.name, here)
                return (
                  <div key={stage.position} className={styles.cell}>
                    {items.length === 0 && <p className={styles.none}>Nothing to infer</p>}
                    {items.map((item) => (
                      <div key={item.text} className={styles.backstageItem}>
                        <span className={styles.backstageKind}>{item.kind}</span>
                        <p className={styles.backstageText}>{item.text}</p>
                      </div>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
