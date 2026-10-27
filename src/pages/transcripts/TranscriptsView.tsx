import { Close } from '@carbon/icons-react'
import { Button, Dropdown, FileUploaderDropContainer, InlineNotification, Loading, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { ProjectDetail, TranscriptList } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { SaveAlerts, type SaveBarProps } from '../project/SaveBar'
import { AnalysisProgress } from './AnalysisProgress'
import type { Platform, TranscriptErrors, TranscriptItem } from './form'
import { ACCEPTED_FILES, PLATFORM_DROP, PLATFORM_FILES, PLATFORM_LABEL, PLATFORM_SHORT } from './platformHelp'
import styles from './TranscriptsView.module.scss'

export type TranscriptsViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  items: TranscriptItem[]
  saved?: TranscriptList
  errors: TranscriptErrors
  errorText?: string
  /** A message after a save, for example that the analysis found nothing. */
  notice?: string
  save: SaveBarProps
  progress: { open: boolean; steps: string[]; current: number }
  onChange: (items: TranscriptItem[]) => void
  onAddFiles: (files: File[], platform: Platform) => void
  onAddSample: (platform: Platform) => void
}

const PLATFORMS = ['zoom', 'meet', 'teams'] as const
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

const PLATFORM_ITEMS: { key: Platform | null; label: string }[] = [{ key: null, label: 'Not specified' }, ...(['zoom', 'meet', 'teams'] as const).map((key) => ({ key, label: PLATFORM_LABEL[key] }))]

// Presentational: pick the meeting tool, drop or try a transcript, review each one, and save (and analyze).
export function TranscriptsView({ state, project, items, saved, errors, errorText, notice, save, progress, onChange, onAddFiles, onAddSample }: TranscriptsViewProps) {
  const [tool, setTool] = useState<Platform>('zoom')
  const [open, setOpen] = useState<Set<string>>(new Set())

  if (state === 'loading') return <Loading small withOverlay={false} description="Loading transcripts" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Transcripts" subtitle={errorText} />

  const readOnly = !save.canEdit
  const patch = (i: number, change: Partial<TranscriptItem>) => onChange(items.map((t, j) => (j === i ? { ...t, ...change } : t)))
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const methods = project.study.methods.join(', ') || 'Research study'

  return (
    <div className={styles.page}>
      <ProjectHeader title="Transcripts" description={`${methods} · ${plural(project.participants.length, 'participant')} · ${plural(items.length, 'transcript')}`} save={save} />
      <SaveAlerts {...save} />
      {notice && <InlineNotification kind="info" lowContrast hideCloseButton title="Analysis" subtitle={notice} />}

      {!readOnly && (
        <section className={styles.add} aria-label="Add a transcript">
          <InlineNotification
            kind="info"
            lowContrast
            hideCloseButton
            title="How this page works"
            subtitle="Pick the tool your sessions were recorded in, then drop one or several transcript files into the box (or click to browse). Each file is treated as one session. Open any of them to check or edit the text, then choose Save and analyze to find the themes."
          />
          <div className={styles.tools} role="group" aria-label="Meeting tool">
            {PLATFORMS.map((p) => (
              <Button key={p} kind={tool === p ? 'primary' : 'tertiary'} size="md" aria-pressed={tool === p} onClick={() => setTool(p)}>
                {PLATFORM_SHORT[p]}
              </Button>
            ))}
          </div>
          <div className={styles.drop}>
            <FileUploaderDropContainer
              accept={ACCEPTED_FILES}
              multiple
              // Carbon types the label as a string but renders it as a node, so the hint can sit under the title.
              labelText={(
                <span className={styles.dropText}>
                  <span className={styles.dropTitle}>Drop {PLATFORM_DROP[tool]} transcripts here, or click to browse</span>
                  <span className={styles.dropTypes}>{PLATFORM_LABEL[tool]} usually exports {PLATFORM_FILES[tool].join(' or ')}. Also accepts {ACCEPTED_FILES.filter((f) => !PLATFORM_FILES[tool].includes(f)).join(', ')}.</span>
                </span>
              ) as unknown as string}
              onAddFiles={(_, { addedFiles }) => onAddFiles(addedFiles, tool)}
            />
          </div>
          <div className={styles.samples}>
            <span className={styles.samplesLabel}>No file handy?</span>
            {PLATFORMS.map((p) => (
              <Button key={p} kind="tertiary" size="md" onClick={() => onAddSample(p)}>
                {PLATFORM_SHORT[p]} sample
              </Button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.list} aria-label="Transcripts">
        {items.length === 0 && <p className={styles.empty}>No transcripts yet. Add one above to analyze this project.</p>}
        {items.map((t, i) => {
          const info = saved?.transcripts.find((s) => s.id === t.id)
          const people = info ? info.speakers.filter((s) => s.role !== 'moderator').length : 0
          return (
            <div key={t.key} className={styles.item} data-testid={`transcript-${i}`}>
              <div className={styles.line}>
                {t.platform && <span className={styles.tool} data-tool={t.platform}>{PLATFORM_SHORT[t.platform]}</span>}
                <span className={styles.name}>{t.name}</span>
                <span className={styles.meta}>
                  {info ? `${info.lineCount} lines · ${plural(people, 'participant')}` : 'Not saved yet'}
                </span>
                <Button kind="ghost" size="sm" onClick={() => toggle(t.key)}>
                  {open.has(t.key) ? 'Hide text' : readOnly ? 'View text' : 'Edit text'}
                </Button>
                {!readOnly && <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription={`Remove ${t.name}`} tooltipPosition="left" onClick={() => onChange(items.filter((_, j) => j !== i))} />}
              </div>
              {errors[i]?.rawText && <p className={styles.error}>{errors[i]?.rawText}</p>}
              {open.has(t.key) && (
                <div className={styles.edit}>
                  <div className={styles.row}>
                    <TextInput id={`transcript-name-${i}`} labelText="Name" readOnly={readOnly} value={t.name} invalid={!!errors[i]?.name} invalidText={errors[i]?.name} onChange={(e) => patch(i, { name: e.target.value })} />
                    <Dropdown
                      id={`transcript-platform-${i}`}
                      titleText="Platform"
                      label="Not specified"
                      disabled={readOnly}
                      items={PLATFORM_ITEMS}
                      itemToString={(x) => x?.label ?? ''}
                      selectedItem={PLATFORM_ITEMS.find((x) => x.key === t.platform) ?? PLATFORM_ITEMS[0]}
                      onChange={({ selectedItem }) => selectedItem && patch(i, { platform: selectedItem.key })}
                    />
                  </div>
                  <TextArea id={`transcript-text-${i}`} labelText={`Text of transcript ${i + 1}`} hideLabel rows={10} readOnly={readOnly} value={t.rawText} onChange={(e) => patch(i, { rawText: e.target.value })} />
                </div>
              )}
            </div>
          )
        })}
      </section>

      <AnalysisProgress open={progress.open} steps={progress.steps} current={progress.current} />
    </div>
  )
}
