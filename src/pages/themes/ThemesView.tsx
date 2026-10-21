import { Button, ClickableTile, InlineNotification, Loading, TextInput } from '@carbon/react'
import { Dropdown } from '@carbon/react'
import { useState } from 'react'
import type { ProjectDetail, Theme, ThemeCategory, ThemePatch } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { CategoryBadge } from './CategoryBadge'
import { CATEGORIES, CATEGORY_LABEL, LEVEL_LABEL, participantsLabel, type Level } from './themeEdits'
import styles from './ThemesView.module.scss'

export type ThemesViewProps = {
  state: 'loading' | 'error' | 'empty' | 'ready'
  project?: ProjectDetail
  themes: Theme[]
  stages: { position: number; name: string }[]
  category: ThemeCategory | 'all'
  selectedId: string | null
  canEdit: boolean
  pending: ReadonlySet<string>
  errorText?: string
  onCategory: (c: ThemeCategory | 'all') => void
  onSelect: (id: string) => void
  onEdit: (theme: Theme, patch: ThemePatch) => void
  onGoTranscripts: () => void
}

// Presentational: the themes found in the transcripts, a filter, and one theme in detail with its quotes.
export function ThemesView({ state, project, themes, stages, category, selectedId, canEdit, pending, errorText, onCategory, onSelect, onEdit, onGoTranscripts }: ThemesViewProps) {
  const selected = themes.find((t) => t.id === selectedId) ?? null
  const shown = category === 'all' ? themes : themes.filter((t) => t.category === category)
  const count = (c: ThemeCategory | 'all') => (c === 'all' ? themes.length : themes.filter((t) => t.category === c).length)
  // The rename box holds what is being typed; it is saved when the person leaves the box.
  const [draft, setDraft] = useState('')
  const [draftFor, setDraftFor] = useState(`${selected?.id}|${selected?.title}`)
  if (draftFor !== `${selected?.id}|${selected?.title}`) {
    setDraftFor(`${selected?.id}|${selected?.title}`)
    setDraft(selected?.title ?? '')
  }

  return (
    <div className={styles.page}>
      {project && <ProjectHeader title="Themes" description="What participants said, grouped by what it means. Each one is placed on the journey map and the priorities map for you to review." />}

      {state === 'loading' && <Loading small withOverlay={false} description="Loading themes" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Themes" subtitle={errorText} />}
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
          <div className={styles.filters} role="group" aria-label="Filter by category">
            {(['all', ...CATEGORIES] as const).map((c) => (
              <Button key={c} size="sm" kind={category === c ? 'primary' : 'tertiary'} aria-pressed={category === c} onClick={() => onCategory(c)}>
                {c === 'all' ? 'All' : CATEGORY_LABEL[c]} {count(c)}
              </Button>
            ))}
          </div>

          <div className={styles.columns}>
            <ul className={styles.list} aria-label="Themes">
              {shown.map((t) => (
                <li key={t.id}>
                  <ClickableTile className={styles.card} data-selected={t.id === selectedId} onClick={() => onSelect(t.id)}>
                    <div className={styles.cardTop}>
                      <CategoryBadge category={t.category} />
                    </div>
                    <p className={styles.cardTitle}>{t.title}</p>
                    <p className={styles.cardMeta}>
                      {participantsLabel(t)} · {LEVEL_LABEL[t.priority as Level]} priority
                    </p>
                  </ClickableTile>
                </li>
              ))}
              {shown.length === 0 && <li className={styles.none}>No themes in this category.</li>}
            </ul>

            <section className={styles.detail} aria-label="Theme detail">
              {!selected && <p className={styles.none}>Select a theme to see what was said.</p>}
              {selected && (
                <>
                  <div className={styles.detailHead}>
                    <CategoryBadge category={selected.category} />
                  </div>
                  <TextInput
                    id="theme-title"
                    labelText="Theme name"
                    readOnly={!canEdit}
                    value={draft}
                    helperText={selected.title !== selected.originalTitle ? `Originally: ${selected.originalTitle}` : undefined}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => canEdit && draft.trim() !== selected.title && onEdit(selected, { title: draft.trim() || null })}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                  <p className={styles.facts}>
                    {participantsLabel(selected)} · {selected.mentionCount} {selected.mentionCount === 1 ? 'mention' : 'mentions'} · {LEVEL_LABEL[selected.priority as Level]} priority
                  </p>
                  {selected.description && <p className={styles.text}>{selected.description}</p>}
                  {selected.opportunity && (
                    <>
                      <h3 className={styles.label}>Opportunity</h3>
                      <p className={styles.text}>{selected.opportunity}</p>
                    </>
                  )}
                  <Dropdown
                    id="theme-stage"
                    titleText="Journey stage"
                    label="Choose a stage"
                    disabled={!canEdit || pending.has(selected.id)}
                    items={stages}
                    itemToString={(s) => s?.name ?? ''}
                    selectedItem={stages.find((s) => s.position === selected.stagePosition) ?? null}
                    onChange={({ selectedItem }) => selectedItem && selectedItem.position !== selected.stagePosition && onEdit(selected, { stagePosition: selectedItem.position })}
                  />
                  <h3 className={styles.label}>What was said</h3>
                  <ul className={styles.quotes}>
                    {(selected.quotes ?? []).map((q) => (
                      <li key={q.id}>
                        <blockquote className={styles.quote}>“{q.text}”</blockquote>
                        <p className={styles.cite}>
                          {q.speaker} · {q.session}
                          {q.timestamp ? ` · ${q.timestamp}` : ''}
                        </p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}
