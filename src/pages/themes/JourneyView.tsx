import { Button, InlineNotification, Loading, OverflowMenu, OverflowMenuItem } from '@carbon/react'
import { useState } from 'react'
import type { ProjectDetail, Theme, ThemePatch } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { CategoryBadge } from './CategoryBadge'
import styles from './JourneyView.module.scss'

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
  onBack: () => void
}

// Presentational: every theme laid out by journey stage, at the stage the analysis suggested unless the person moved it. A theme moves by dragging it to a stage, or with its
// menu, which is the way to do it without a mouse.
export function JourneyView({ state, project, stages, themes, canEdit, pending, errorText, onEdit, onGoTranscripts, onBack }: JourneyViewProps) {
  const [over, setOver] = useState<number | null>(null)
  const stageOf = (t: Theme) => t.stagePosition ?? 0
  const drop = (position: number, id: string) => {
    const theme = themes.find((t) => t.id === id)
    if (theme && canEdit && stageOf(theme) !== position) onEdit(theme, { stagePosition: position })
  }

  return (
    <div className={styles.page}>
      {project && <ProjectHeader name={project.name} status={project.status} title="Journey Map" description="Where each theme falls along the customer journey. Drag a theme to another stage to move it." onBack={onBack} />}

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
        <>
          <div className={styles.map} data-columns={stages.length}>
            {stages.map((stage) => {
              const here = themes.filter((t) => stageOf(t) === stage.position)
              return (
                <section
                  key={stage.position}
                  className={styles.column}
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
                  <h2 className={styles.stage}>
                    {stage.name} <span className={styles.count}>{here.length}</span>
                  </h2>
                  {here.map((t) => (
                    <article key={t.id} className={styles.card} draggable={canEdit && !pending.has(t.id)} onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}>
                      <div className={styles.cardTop}>
                        <CategoryBadge category={t.category} />
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
                      <p className={styles.title}>{t.title}</p>
                    </article>
                  ))}
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
