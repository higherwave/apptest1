import { Close } from '@carbon/icons-react'
import { Button, Dropdown, FileUploaderDropContainer, InlineNotification, Loading, Tab, TabList, TabPanel, TabPanels, Tabs, TextArea, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { ProjectDetail, TranscriptList } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import { SaveAlerts, type SaveBarProps } from '../project/SaveBar'
import { AnalysisProgress } from './AnalysisProgress'
import type { Platform, Source, TranscriptErrors, TranscriptItem } from './form'
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
  onAddFiles: (files: File[], platform: Platform, source: Source) => void
  onAddSample: (platform: Platform, source: Source) => void
}

const PLATFORMS = ['zoom', 'meet', 'teams'] as const
const SOURCES: { key: Source; label: string; title: string; how: string }[] = [
  {
    key: 'customer',
    label: 'Customer feedback',
    title: 'Sessions with customers',
    how: 'Pick the tool the session was recorded in, then drop one or several transcript files (each file is one session). Review or edit the text, then choose Save and analyze: this is what themes, reach and priority are built on.',
  },
  {
    key: 'team',
    label: 'Team feedback',
    title: 'Conversations with your team',
    how: 'Add transcripts of CSM, Support, Sales and other internal conversations the same way: pick the tool, then drop the files. They are analyzed with the customer sessions to confirm what others hear too, and never count toward customer reach.',
  },
]
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

const PLATFORM_ITEMS: { key: Platform | null; label: string }[] = [{ key: null, label: 'Not specified' }, ...(['zoom', 'meet', 'teams'] as const).map((key) => ({ key, label: PLATFORM_LABEL[key] }))]

// Presentational: pick the meeting tool, drop or try a transcript, review each one, and save (and analyze).
export function TranscriptsView({ state, project, items, saved, errors, errorText, notice, save, progress, onChange, onAddFiles, onAddSample }: TranscriptsViewProps) {
  const [tool, setTool] = useState<Platform>('zoom')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [source, setSource] = useState<Source>('customer') // Customer feedback is the default tab

  if (state === 'loading') return <Loading small withOverlay={false} description="Loading transcripts" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Transcripts" subtitle={errorText} />

  const readOnly = !save.canEdit
  const patch = (i: number, change: Partial<TranscriptItem>) => onChange(items.map((t, j) => (j === i ? { ...t, ...change } : t)))
  const toggle = (key: string) => setOpen((o) => { const n = new Set(o); if (n.has(key)) n.delete(key); else n.add(key); return n })
  const customerCount = items.filter((t) => t.source === 'customer').length
  const teamCount = items.length - customerCount
  const here = SOURCES.find((x) => x.key === source)!

  return (
    <div className={styles.page}>
      <ProjectHeader title="Transcripts" description={`Customer sessions and team conversations, analyzed together · ${plural(project.participants.length, 'participant')} · ${customerCount} customer, ${teamCount} team`} save={save} />
      <SaveAlerts {...save} />
      {notice && <InlineNotification kind="info" lowContrast hideCloseButton title="Analysis" subtitle={notice} />}

      <Tabs selectedIndex={SOURCES.findIndex((x) => x.key === source)} onChange={({ selectedIndex }) => setSource(SOURCES[selectedIndex].key)}>
        <TabList aria-label="Where the feedback came from">
          {SOURCES.map((x) => (
            <Tab key={x.key} data-testid={`source-${x.key}`}>
              {x.label} · {x.key === 'team' ? teamCount : customerCount}
            </Tab>
          ))}
        </TabList>
        <TabPanels>
          {SOURCES.map((x) => (
            <TabPanel key={x.key} className={styles.tabPanel}>
              {source === x.key && (
                <div className={styles.panel}>
      {!readOnly && (
        <section className={styles.add} aria-label="Add a transcript">
          <InlineNotification kind="info" lowContrast hideCloseButton title={here.title} subtitle={here.how} />
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
              onAddFiles={(_, { addedFiles }) => onAddFiles(addedFiles, tool, source)}
            />
          </div>
          <div className={styles.samples}>
            <span className={styles.samplesLabel}>No file handy?</span>
            {PLATFORMS.map((p) => (
              <Button key={p} kind="tertiary" size="md" onClick={() => onAddSample(p, source)}>
                {PLATFORM_SHORT[p]} sample
              </Button>
            ))}
          </div>
        </section>
      )}

      <section className={styles.list} aria-label="Transcripts">
        {!items.some((t) => t.source === source) && <p className={styles.empty}>No {source === 'team' ? 'team' : 'customer'} transcripts yet.{readOnly ? '' : ' Add one above.'}</p>}
        {items.map((t, i) => {
          if (t.source !== source) return null
          const info = saved?.transcripts.find((s) => s.id === t.id)
          const people = info ? info.speakers.filter((s) => s.role !== 'moderator').length : 0
          return (
            <div key={t.key} className={styles.item} data-testid={`transcript-${i}`}>
              <div className={styles.line}>
                {t.platform && <img className={styles.tool} data-tool={t.platform} src={`/platforms/${t.platform}.svg`} alt={PLATFORM_LABEL[t.platform]} title={PLATFORM_LABEL[t.platform]} width={28} height={28} />}
                <span className={styles.name}>{t.name}</span>
                <span className={styles.meta}>
                  {info ? `${info.lineCount} lines · ${source === 'team' ? plural(people, 'speaker') : plural(people, 'participant')}` : 'Not saved yet'}
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

                </div>
              )}
            </TabPanel>
          ))}
        </TabPanels>
      </Tabs>

      <AnalysisProgress open={progress.open} steps={progress.steps} current={progress.current} />
    </div>
  )
}
