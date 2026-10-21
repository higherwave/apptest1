import { Button, Dropdown, InlineNotification, Loading, Tag } from '@carbon/react'
import type { ProjectDetail, Theme, ThemePatch } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { CategoryBadge } from './CategoryBadge'
import { EFFORT_LABEL, LEVELS, LEVEL_LABEL, ZONES, cellKey, importanceOf, levelOf, matrixPatch, participantsLabel, type Level } from './themeEdits'
import styles from './PrioritiesView.module.scss'

export type PrioritiesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  project?: ProjectDetail
  themes: Theme[]
  selectedId: string | null
  canEdit: boolean
  pending: ReadonlySet<string>
  errorText?: string
  onSelect: (id: string) => void
  onEdit: (theme: Theme, patch: ThemePatch) => void
  onResetAll: () => void
  onGoTranscripts: () => void
  onBack: () => void
}

const IMPORTANCE_ROWS = [3, 2, 1]
const EFFORT_COLUMNS = [1, 2, 3]
const IMPORTANCE_ITEMS = LEVELS.map((l) => ({ level: l, label: LEVEL_LABEL[l] }))
const EFFORT_ITEMS = EFFORT_COLUMNS.map((n) => ({ effort: n, label: EFFORT_LABEL[n] }))

// Presentational: themes placed by importance (rows) and effort (columns). A theme moves by dragging it to a cell, or
// with the two menus in its panel.
export function PrioritiesView({ state, project, themes, selectedId, canEdit, pending, errorText, onSelect, onEdit, onResetAll, onGoTranscripts, onBack }: PrioritiesViewProps) {
  const selected = themes.find((t) => t.id === selectedId) ?? null
  const anyEdited = themes.some((t) => t.edited)

  return (
    <div className={styles.page}>
      {project && <ProjectHeader name={project.name} status={project.status} title="Priorities" description="Importance against effort. Drag a theme, or use its menus, to override the suggestion." onBack={onBack} />}

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
        <div className={styles.columns}>
          <div>
            <div className={styles.toolbar}>
              <Button kind="tertiary" size="sm" disabled={!canEdit || !anyEdited} onClick={onResetAll}>
                Reset all
              </Button>
            </div>
            <div className={styles.matrix}>
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
                          <Button
                            key={t.id}
                            className={styles.chip}
                            kind={t.id === selectedId ? 'primary' : 'tertiary'}
                            size="sm"
                            draggable={canEdit && !pending.has(t.id)}
                            onDragStart={(e: React.DragEvent) => e.dataTransfer.setData('text/plain', t.id)}
                            onClick={() => onSelect(t.id)}
                          >
                            {t.title}
                          </Button>
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

          <section className={styles.panel} aria-label="Theme priority">
            {!selected && <p className={styles.none}>Select a theme to see its suggestion and change it.</p>}
            {selected && (
              <>
                <div className={styles.panelHead}>
                  <CategoryBadge category={selected.category} />
                  {selected.edited && (
                    <Tag size="sm" type="warm-gray">
                      Edited
                    </Tag>
                  )}
                </div>
                <h2 className={styles.panelTitle}>{selected.title}</h2>
                <p className={styles.facts}>{participantsLabel(selected)}</p>
                <p className={styles.facts}>
                  Suggested: {LEVEL_LABEL[selected.suggestedPriority as Level]} importance, {EFFORT_LABEL[selected.suggestedEffort]} effort.
                </p>
                {selected.effortNote && <p className={styles.note}>{selected.effortNote}</p>}
                <Dropdown
                  id="importance"
                  titleText="Importance"
                  label="Importance"
                  disabled={!canEdit || pending.has(selected.id)}
                  items={IMPORTANCE_ITEMS}
                  itemToString={(i) => i?.label ?? ''}
                  selectedItem={IMPORTANCE_ITEMS[importanceOf(selected.priority as Level) - 1]}
                  onChange={({ selectedItem }) => selectedItem && onEdit(selected, matrixPatch(selected, importanceOf(selectedItem.level), selected.effort))}
                />
                <Dropdown
                  id="effort"
                  titleText="Effort"
                  label="Effort"
                  disabled={!canEdit || pending.has(selected.id)}
                  items={EFFORT_ITEMS}
                  itemToString={(i) => i?.label ?? ''}
                  selectedItem={EFFORT_ITEMS[selected.effort - 1]}
                  onChange={({ selectedItem }) => selectedItem && onEdit(selected, matrixPatch(selected, importanceOf(selected.priority as Level), selectedItem.effort))}
                />
                <Button kind="ghost" size="sm" disabled={!canEdit || !selected.edited || pending.has(selected.id)} onClick={() => onEdit(selected, { priority: null, effort: null })}>
                  Reset to suggestion
                </Button>
              </>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
