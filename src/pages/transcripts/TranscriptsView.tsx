import { Add, TrashCan } from '@carbon/icons-react'
import { Button, Dropdown, FileUploaderDropContainer, InlineNotification, Loading, Tag, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { ProjectDetail, TranscriptList } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { SaveBar, type SaveBarProps } from '../project/SaveBar'
import { AnalysisProgress } from './AnalysisProgress'
import type { Platform, TranscriptErrors, TranscriptItem } from './form'
import { ACCEPTED_FILES, PLATFORM_HELP, PLATFORM_LABEL } from './platformHelp'
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
  onAddFiles: (files: File[]) => void
  onAddPasted: (name: string, text: string) => void
}

const PLATFORM_ITEMS: { key: Platform | null; label: string }[] = [{ key: null, label: 'Not specified' }, ...(['zoom', 'meet', 'teams'] as const).map((key) => ({ key, label: PLATFORM_LABEL[key] }))]

// Presentational: upload or paste transcripts, review each one, and save (and analyze).
export function TranscriptsView({ state, project, items, saved, errors, errorText, notice, save, progress, onChange, onAddFiles, onAddPasted }: TranscriptsViewProps) {
  const [pasteName, setPasteName] = useState('')
  const [pasteText, setPasteText] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())

  if (state === 'loading') return <Loading small withOverlay={false} description="Loading transcripts" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Transcripts" subtitle={errorText} />

  const readOnly = !save.canEdit
  const patch = (i: number, change: Partial<TranscriptItem>) => onChange(items.map((t, j) => (j === i ? { ...t, ...change } : t)))
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n })

  return (
    <div className={styles.page}>
      <ProjectHeader title="Transcripts" description="Paste or upload each session's transcript. Save and analyze reads them for themes." />
      <SaveBar {...save} />
      {notice && <InlineNotification kind="info" lowContrast hideCloseButton title="Analysis" subtitle={notice} />}

      {!readOnly && (
        <section className={styles.add}>
          <h2 className={styles.section}>Add a transcript</h2>
          <FileUploaderDropContainer
            accept={ACCEPTED_FILES}
            multiple
            labelText="Drag and drop transcripts here, or click to choose files (.vtt, .txt, .sbv, .srt)"
            onAddFiles={(_, { addedFiles }) => onAddFiles(addedFiles)}
          />
          <details className={styles.help}>
            <summary>Where do I get a transcript?</summary>
            <ul>
              {PLATFORM_HELP.map((p) => (
                <li key={p.key}>
                  <strong>{p.name}:</strong> {p.text}
                </li>
              ))}
            </ul>
          </details>
          <div className={styles.paste}>
            <TextInput id="paste-name" labelText="Or paste text: session name" value={pasteName} onChange={(e) => setPasteName(e.target.value)} />
            <TextArea id="paste-text" labelText="Transcript text" rows={5} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'00:00:12 Maya Chen: I open the app and try to see who is available.'} />
            <Button
              kind="secondary"
              size="md"
              renderIcon={Add}
              disabled={!pasteName.trim() || !pasteText.trim()}
              onClick={() => {
                onAddPasted(pasteName.trim(), pasteText)
                setPasteName('')
                setPasteText('')
              }}
            >
              Add transcript
            </Button>
          </div>
        </section>
      )}

      <section className={styles.list}>
        <h2 className={styles.section}>{items.length ? `Transcripts (${items.length})` : 'Transcripts'}</h2>
        {items.length === 0 && <p className={styles.empty}>No transcripts yet. Add one above to analyze this project.</p>}
        {items.map((t, i) => {
          const info = saved?.transcripts.find((s) => s.id === t.id)
          return (
            <fieldset key={t.key} className={styles.item}>
              <legend className={styles.legend}>Transcript {i + 1}</legend>
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
              <div className={styles.meta}>
                {info ? (
                  <>
                    <span className={styles.lines}>{info.lineCount} lines</span>
                    {info.speakers.map((s) => (
                      <Tag key={s.name} size="sm" type={s.role === 'moderator' ? 'gray' : s.participant ? 'green' : 'warm-gray'}>
                        {s.role === 'moderator' ? (/moderator/i.test(s.name) ? s.name : `${s.name} (moderator)`) : s.participant ? s.name : `${s.name} (no matching participant)`}
                      </Tag>
                    ))}
                  </>
                ) : (
                  <span className={styles.lines}>Not saved yet</span>
                )}
              </div>
              {errors[i]?.rawText && <p className={styles.error}>{errors[i]?.rawText}</p>}
              {open.has(t.key) && (
                <TextArea id={`transcript-text-${i}`} labelText={`Text of transcript ${i + 1}`} hideLabel rows={10} readOnly={readOnly} value={t.rawText} onChange={(e) => patch(i, { rawText: e.target.value })} />
              )}
              <div className={styles.actions}>
                <Button kind="ghost" size="sm" onClick={() => toggle(t.key)}>
                  {open.has(t.key) ? 'Hide text' : readOnly ? 'View text' : 'Edit text'}
                </Button>
                {!readOnly && (
                  <Button kind="ghost" size="sm" renderIcon={TrashCan} onClick={() => onChange(items.filter((_, j) => j !== i))}>
                    Remove
                  </Button>
                )}
              </div>
            </fieldset>
          )
        })}
      </section>

      <AnalysisProgress open={progress.open} steps={progress.steps} current={progress.current} />
    </div>
  )
}
