import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, getTranscripts, type AnalysisRunResult } from '../../api/client'
import { transcriptApi, useMe, useProject, useTranscripts } from '../../api/hooks'
import { useSaveFlow } from '../project/useSaveFlow'
import { SAMPLE_TRANSCRIPTS } from './samples'
import { errorFromField, fileToItem, formFromList, itemsChanged, toRequest, validateItems, type TranscriptErrors, type TranscriptItem } from './form'
import { TranscriptsView } from './TranscriptsView'

const STEP_MS = 650 // how long each progress step is shown, so the analysis reads as the process it stands in for

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Container: edits a copy of the transcript list. Save writes the changes, then runs the (simulated) analysis
// when there is anything to read, with a progress dialog; the person then lands on Themes.
export function TranscriptsPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const project = useProject(projectId)
  const transcripts = useTranscripts(projectId)
  const me = useMe()
  const flow = useSaveFlow(projectId, project.data)
  const [items, setItems] = useState<TranscriptItem[] | null>(null)
  const [errors, setErrors] = useState<TranscriptErrors>({})
  const [notice, setNotice] = useState<string | undefined>()
  const [progress, setProgress] = useState({ open: false, steps: [] as string[], current: 0 })
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined)

  // The form starts from the saved list once it arrives; after that the person's edits are the form.
  if (transcripts.data && items === null) setItems(formFromList(transcripts.data))
  useEffect(() => () => clearInterval(timer.current), [])

  const saved = transcripts.data
  const changed = !!saved && !!items && itemsChanged(items, saved)
  const needsAnalysis = !!saved?.needsAnalysis
  const dirty = changed
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'
  const willAnalyze = !!items && items.length > 0

  const startProgress = (steps: string[]) => {
    setProgress({ open: true, steps, current: 0 })
    timer.current = setInterval(() => setProgress((p) => ({ ...p, current: Math.min(p.current + 1, p.steps.length - 1) })), STEP_MS)
  }
  const finishProgress = async () => {
    clearInterval(timer.current)
    setProgress((p) => ({ ...p, current: p.steps.length })) // every step ticked
    await wait(450)
    setProgress({ open: false, steps: [], current: 0 })
  }

  const doSave = async (overwrite: boolean) => {
    if (!items || !project.data) return
    const found = validateItems(items)
    setErrors(found)
    if (Object.keys(found).length) return
    setNotice(undefined)

    let result: AnalysisRunResult | undefined
    const after = await flow.save(async (startVersion) => {
      let version = startVersion
      if (changed) {
        try {
          await transcriptApi.save(projectId, version, toRequest(items))
        } catch (err) {
          if (err instanceof ApiRequestError && err.code === 'validation_failed') setErrors(errorFromField(err.field, err.message))
          throw err
        }
        version = (await transcriptApi.project(projectId)).version
      }
      if (willAnalyze && (changed || needsAnalysis)) {
        startProgress(['Parsing transcripts', 'Identifying speakers', 'Clustering statements', 'Scoring and prioritizing', 'Porting themes to journey map'])
        try {
          const [run] = await Promise.all([transcriptApi.analyze(projectId, version), wait(STEP_MS * 5)])
          result = run
        } finally {
          await finishProgress()
        }
      }
      return transcriptApi.project(projectId)
    }, overwrite)

    if (!after) return
    queryClient.setQueryData(['project', projectId], after)
    await Promise.all([queryClient.invalidateQueries({ queryKey: ['projects'] }), queryClient.invalidateQueries({ queryKey: ['stage', projectId] })])
    // Read the transcripts back, so the page shows exactly what was saved (ids, line counts, matched speakers).
    const fresh = await queryClient.fetchQuery({ queryKey: ['transcripts', projectId], queryFn: () => getTranscripts(projectId), staleTime: 0 })
    setItems(formFromList(fresh))
    if (result && result.themes > 0) navigate(`/projects/${projectId}/themes`)
    else if (result) setNotice('The simulated analysis found no themes in these transcripts. It looks for topics such as availability, insurance, fees, rescheduling, reminders and follow-up.')
  }

  const state = project.isError || transcripts.isError ? 'error' : project.isPending || transcripts.isPending || items === null ? 'loading' : 'ready'

  return (
    <TranscriptsView
      state={state}
      project={project.data}
      items={items ?? []}
      saved={saved}
      errors={errors}
      errorText={project.isError ? friendlyMessage(project.error) : transcripts.isError ? friendlyMessage(transcripts.error) : undefined}
      notice={notice}
      progress={progress}
      save={{
        dirty, canEdit, saving: flow.saving, conflict: flow.conflict, error: flow.error, savedAt: flow.savedAt,
        saveLabel: willAnalyze ? 'Save and analyze' : 'Save',
        actionable: willAnalyze && needsAnalysis,
        note: needsAnalysis && !dirty ? 'Analysis is out of date' : undefined,
        onSave: () => doSave(false),
        onOverwrite: () => doSave(true),
        onReload: async () => {
          const fresh = await flow.reload()
          const list = await queryClient.fetchQuery({ queryKey: ['transcripts', projectId], queryFn: () => getTranscripts(projectId), staleTime: 0 })
          if (fresh) setItems(formFromList(list))
          setErrors({})
        },
      }}
      onChange={setItems}
      onAddFiles={async (files, platform) => {
        const added = await Promise.all(files.map(async (f) => fileToItem(f.name, await f.text(), platform)))
        setItems((cur) => [...(cur ?? []), ...added])
      }}
      onAddSample={(platform) => setItems((cur) => [...(cur ?? []), fileToItem(SAMPLE_TRANSCRIPTS[platform].name, SAMPLE_TRANSCRIPTS[platform].text, platform)])}
    />
  )
}
