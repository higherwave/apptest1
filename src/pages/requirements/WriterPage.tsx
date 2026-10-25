import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiRequestError, approveStep, createSpec, deleteSpec, draftWaitingStep, editStep, friendlyMessage, publishSpec, redoStep, setSpecTheme, syncBoard, type BoardSyncPlan, type SpecDetail, type SpecStep } from '../../api/client'
import { useMe, useSpec } from '../../api/hooks'
import { WriterView, type StepWork } from './WriterView'

// Container: runs the review flow. Each action is sent with the version of the step (or the document) the person is
// looking at; the answer is the document as it is now, which replaces the cached copy. A step drafted by an action
// in this session is typed out gradually; steps loaded from the server are shown whole.
export function WriterPage() {
  const { specId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const spec = useSpec(specId)
  const me = useMe()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [notice, setNotice] = useState<string | undefined>()
  const [freshStepId, setFreshStepId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [board, setBoard] = useState<{ plan: BoardSyncPlan; error?: string } | null>(null)
  const [startOver, setStartOver] = useState<{ error?: string } | null>(null)
  const [readyCue, setReadyCue] = useState(0)
  const [work, setWork] = useState<StepWork | null>(null)
  const [stepError, setStepError] = useState<{ id: string; text: string } | null>(null)
  const [redoing, setRedoing] = useState<{ step: SpecStep; text: string } | null>(null)

  // A document just started from the list opens with its first step being written.
  const startedFresh = (location.state as { fresh?: boolean } | null)?.fresh
  useEffect(() => {
    if (startedFresh && spec.data && freshStepId === null) setFreshStepId(spec.data.steps.find((s) => s.status === 'review')?.id ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startedFresh, spec.data?.id])

  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'

  // `working` says which step is being approved, rewritten or written, so the page can show it at once; `errorStepId` puts a failure
  // next to that step (where the person is looking) instead of in the banner at the top of the page.
  async function act(run: () => Promise<SpecDetail>, animate: boolean, working?: StepWork) {
    const before = spec.data
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    setStepError(null)
    setWork(working ?? null)
    try {
      const next = await run()
      queryClient.setQueryData(['spec', specId], next)
      // The document has just become ready to publish (or the published one has changes for the board): bring that banner into view.
      const waiting = (d?: SpecDetail) => !!d && (d.canPublish || (d.status === 'published' && !d.standalone && (d.boardChanges ?? 0) > 0))
      if (waiting(next) && !waiting(before)) setReadyCue((c) => c + 1)
      // The step that has just been drafted (it entered review, or was redone), not one that was merely edited.
      const drafted = animate ? next.steps.find((s) => s.status === 'review' && (before?.steps.find((b) => b.id === s.id)?.status !== 'review' || s.revision > (before?.steps.find((b) => b.id === s.id)?.revision ?? 0))) : undefined
      setFreshStepId(drafted?.id ?? null)
      queryClient.invalidateQueries({ queryKey: ['specs'] })
      return true
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'version_conflict') {
        await queryClient.invalidateQueries({ queryKey: ['spec', specId] })
        setNotice('Someone else changed this document, so it has been reloaded. Your last action was not applied.')
      } else {
        if (working) setStepError({ id: working.id, text: friendlyMessage(err) })
        else setError(friendlyMessage(err))
        if (err instanceof ApiRequestError && (err.code === 'step_not_ready' || err.code === 'spec_published')) await queryClient.invalidateQueries({ queryKey: ['spec', specId] })
      }
      return false
    } finally {
      setWork(null)
      setBusy(false)
    }
  }

  // Starts a waiting step whose earlier step is approved. Uses the step as the cache holds it right now, because approving has just changed it.
  async function writeStep(stepId: string) {
    const step = queryClient.getQueryData<SpecDetail>(['spec', specId])?.steps.find((s) => s.id === stepId)
    if (step?.status === 'pending') await act(() => draftWaitingStep(step.id, step.version), true, { kind: 'write', id: step.id, nextId: step.id })
  }

  const doc = spec.data
  // A stand-alone document has no project of its own to go back to, so it returns to wherever the person came from.
  const back = () => navigate(-1)

  // "Update board": shows what would change first, then does it once confirmed.
  async function previewBoard() {
    if (!doc) return
    setBusy(true)
    setError(undefined)
    try {
      setBoard({ plan: await syncBoard(doc.id, false) })
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function confirmBoard() {
    if (!doc || !board) return
    setBusy(true)
    try {
      await syncBoard(doc.id, true)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['spec', specId] }),
        queryClient.invalidateQueries({ queryKey: ['board', doc.projectId] }),
        queryClient.invalidateQueries({ queryKey: ['stage', doc.projectId] }),
      ])
      setBoard(null)
    } catch (err) {
      setBoard({ ...board, error: friendlyMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  // Throws the document away and drafts a new one from the project's current themes (its one document), which then opens.
  async function confirmStartOver() {
    if (!doc) return
    setBusy(true)
    try {
      await deleteSpec(doc.id)
      let fresh: SpecDetail
      try {
        fresh = await createSpec(doc.projectId)
      } catch {
        // The old document is gone and the new one could not be drafted: the Requirements step offers to try again.
        await Promise.all([queryClient.invalidateQueries({ queryKey: ['specs'] }), queryClient.invalidateQueries({ queryKey: ['stage', doc.projectId] })])
        setStartOver(null)
        navigate(`/projects/${doc.projectId}/requirements`, { replace: true })
        return
      }
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['specs'] }), queryClient.invalidateQueries({ queryKey: ['stage', doc.projectId] })])
      setStartOver(null)
      setFreshStepId(null)
      navigate(`/projects/${doc.projectId}/requirements/${fresh.id}`, { replace: true, state: { fresh: true } })
    } catch (err) {
      setStartOver({ error: friendlyMessage(err) })
      await queryClient.invalidateQueries({ queryKey: ['specs'] })
    } finally {
      setBusy(false)
    }
  }

  async function publish() {
    if (!doc) return
    setBusy(true)
    setError(undefined)
    try {
      await publishSpec(doc.id, doc.version)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['spec', specId] }),
        queryClient.invalidateQueries({ queryKey: ['specs'] }),
        queryClient.invalidateQueries({ queryKey: ['stage', doc.projectId] }),
      ])
      if (!doc.standalone) navigate(`/projects/${doc.projectId}/stories`)
    } catch (err) {
      setError(friendlyMessage(err))
      await queryClient.invalidateQueries({ queryKey: ['spec', specId] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <WriterView
      state={spec.isError ? 'error' : spec.isPending ? 'loading' : 'ready'}
      spec={doc}
      canEdit={canEdit}
      busy={busy}
      errorText={spec.isError ? friendlyMessage(spec.error) : error}
      notice={notice}
      freshStepId={freshStepId}
      editingId={editing?.id ?? null}
      draft={editing?.text ?? ''}
      readyCue={readyCue}
      work={work}
      stepError={stepError}
      redoing={redoing?.step ?? null}
      redoText={redoing?.text ?? ''}
      onToggleTheme={(themeId, included) => doc && act(() => setSpecTheme(doc.id, themeId, doc.version, included), false)}
      onDraft={(text) => setEditing((e) => (e ? { ...e, text } : e))}
      onEditStart={(step) => setEditing({ id: step.id, text: step.text ?? '' })}
      onEditCancel={() => setEditing(null)}
      onEditSave={async () => {
        const step = doc?.steps.find((s) => s.id === editing?.id)
        if (step && editing && (await act(() => editStep(step.id, step.version, editing.text), false))) setEditing(null)
      }}
      onApprove={async (step) => {
        // Approving is quick. The next step is only started once the approval has gone through.
        const next = doc?.steps.find((s) => s.position === step.position + 1)
        const approved = await act(() => approveStep(step.id, step.version), false, { kind: 'approve', id: step.id, nextId: null })
        if (approved && next?.status === 'pending') await writeStep(next.id)
      }}
      onWrite={(step) => writeStep(step.id)}
      onRedo={(step) => setRedoing({ step, text: '' })}
      onRedoText={(text) => setRedoing((r) => (r ? { ...r, text } : r))}
      onCancelRedo={() => setRedoing(null)}
      onSubmitRedo={async () => {
        if (!redoing) return
        const { step, text } = redoing
        setRedoing(null) // the dialog closes at once and the step shows that it is being rewritten
        if (!(await act(() => redoStep(step.id, step.version, text.trim()), true, { kind: 'redo', id: step.id, nextId: null }))) setRedoing({ step, text })
      }}
      onPublish={publish}
      onViewStories={() => doc && navigate(`/projects/${doc.projectId}/stories`)}
      onBack={back}
      boardPlan={board?.plan ?? null}
      boardError={board?.error}
      onUpdateBoard={previewBoard}
      onCancelBoard={() => setBoard(null)}
      onConfirmBoard={confirmBoard}
      startOverOpen={startOver !== null}
      startOverError={startOver?.error}
      onStartOver={() => setStartOver({})}
      onCancelStartOver={() => setStartOver(null)}
      onConfirmStartOver={confirmStartOver}
    />
  )
}
