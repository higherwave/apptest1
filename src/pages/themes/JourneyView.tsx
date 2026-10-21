import { Button, InlineNotification, Loading, OverflowMenu, OverflowMenuItem } from '@carbon/react'
import { useState } from 'react'
import type { ProjectDetail, Theme, ThemePatch } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { sentimentTop, stageOpportunity, stagePainPoints, stageSentiment } from './journeyMap'
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
}

// Presentational: every theme laid out by journey stage, at the stage the analysis suggested unless the person moved it. A theme moves by dragging it to a stage, or with its
// menu, which is the way to do it without a mouse.
export function JourneyView({ state, project, stages, themes, canEdit, pending, errorText, onEdit, onGoTranscripts }: JourneyViewProps) {
  const [over, setOver] = useState<number | null>(null)
  const stageOf = (t: Theme) => t.stagePosition ?? 0
  // One sentiment point per stage that has themes, placed at the middle of its column.
  const points = stages.flatMap((stage, i) => {
    const sentiment = stageSentiment(themes.filter((t) => stageOf(t) === stage.position))
    return sentiment === null ? [] : [{ position: stage.position, sentiment, left: ((i + 0.5) / stages.length) * 100, top: sentimentTop(sentiment) }]
  })
  const sentimentLabel = points.length
    ? 'Sentiment by stage: ' + points.map((p) => `${stages.find((s) => s.position === p.position)?.name} ${p.sentiment < 0 ? 'negative' : 'positive'}`).join(', ')
    : 'No sentiment to show'
  const drop = (position: number, id: string) => {
    const theme = themes.find((t) => t.id === id)
    if (theme && canEdit && stageOf(theme) !== position) onEdit(theme, { stagePosition: position })
  }

  return (
    <div className={styles.page}>
      {project && <ProjectHeader title="Journey Map" description="Where each theme falls along the customer journey. Drag a theme to another stage to move it." />}

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

            <div className={cx(styles.row, styles.sentimentRow)}>
              <div className={styles.rowLabel}>Sentiment</div>
              <div className={styles.sentiment} role="img" aria-label={sentimentLabel}>
                <span className={styles.axisTop}>Positive</span>
                <span className={styles.axisBottom}>Negative</span>
                <span className={styles.zero} />
                {points.length > 1 && (
                  <svg className={styles.line} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
                    <polyline points={points.map((p) => `${p.left},${p.top}`).join(' ')} />
                  </svg>
                )}
                {stages.map((stage) => {
                  const p = points.find((x) => x.position === stage.position)
                  return (
                    <div key={stage.position} className={styles.track}>
                      {p && <span className={cx(styles.point, styles[`y${Math.round(p.top)}`])} data-tone={p.sentiment < 0 ? 'negative' : 'positive'} />}
                    </div>
                  )
                })}
              </div>
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
          </div>
        </div>
      )}
    </div>
  )
}
