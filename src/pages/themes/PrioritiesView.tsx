import { Button, InlineNotification, Loading } from '@carbon/react'
import type { ProjectDetail, Theme, ThemePatch } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { PriorityNode } from './PriorityNode'
import { EFFORT_LABEL, LEVEL_LABEL, ZONES, cellKey, levelOf, matrixPatch } from './themeEdits'
import styles from './PrioritiesView.module.scss'

export type PrioritiesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  project?: ProjectDetail
  themes: Theme[]
  canEdit: boolean
  pending: ReadonlySet<string>
  errorText?: string
  onEdit: (theme: Theme, patch: ThemePatch) => void
  onResetAll: () => void
  onGoTranscripts: () => void
}

const IMPORTANCE_ROWS = [3, 2, 1]
const EFFORT_COLUMNS = [1, 2, 3]

// Presentational: themes placed by importance (rows) and effort (columns), across the whole width: the map is the point of the page. A theme moves by dragging
// it to a cell, or with the three-dot menu on its node (for people who cannot drag); its details open beside it when the pointer rests on it.
export function PrioritiesView({ state, project, themes, canEdit, pending, errorText, onEdit, onResetAll, onGoTranscripts }: PrioritiesViewProps) {
  const anyEdited = themes.some((t) => t.edited)

  return (
    <div className={styles.page}>
      {project && <ProjectHeader title="Priorities" description="Importance against effort. Drag a theme, or use its three-dot menu, to override the suggestion. Rest on a theme to see its details." />}

      {state === 'loading' && <Loading small withOverlay={false} description="Loading priorities" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Priorities" subtitle={errorText} />}
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
        <div>
          <div className={styles.toolbar}>
            <Button kind="tertiary" size="sm" disabled={!canEdit || !anyEdited} onClick={onResetAll}>
              Reset all
            </Button>
          </div>
          <div className={styles.matrix} data-tour="priority-matrix">
            <span className={styles.axisY}>Importance</span>
            {IMPORTANCE_ROWS.map((imp) => (
              <div key={imp} className={styles.row}>
                <span className={styles.rowLabel}>{LEVEL_LABEL[levelOf(imp)]}</span>
                {EFFORT_COLUMNS.map((eff) => {
                  const key = `${imp}-${eff}`
                  const here = themes.filter((t) => cellKey(t) === key)
                  return (
                    <div
                      key={key}
                      className={styles.cell}
                      role="group"
                      aria-label={`Importance ${LEVEL_LABEL[levelOf(imp)]}, effort ${EFFORT_LABEL[eff]}${ZONES[key] ? `: ${ZONES[key]}` : ''}`}
                      data-zone={ZONES[key] ? 'true' : 'false'}
                      onDragOver={(e) => canEdit && e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault()
                        const theme = themes.find((t) => t.id === e.dataTransfer.getData('text/plain'))
                        if (theme && canEdit && !pending.has(theme.id) && cellKey(theme) !== key) onEdit(theme, matrixPatch(theme, imp, eff))
                      }}
                    >
                      {ZONES[key] && <span className={styles.zone}>{ZONES[key]}</span>}
                      {here.map((t) => (
                        <PriorityNode key={t.id} theme={t} canEdit={canEdit} busy={pending.has(t.id)} onEdit={onEdit} />
                      ))}
                    </div>
                  )
                })}
              </div>
            ))}
            <div className={styles.footer}>
              <span />
              {EFFORT_COLUMNS.map((eff) => (
                <span key={eff} className={styles.colLabel}>
                  {EFFORT_LABEL[eff]}
                </span>
              ))}
            </div>
            <span className={styles.axisX}>Effort</span>
          </div>
        </div>
      )}
    </div>
  )
}
