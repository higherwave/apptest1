import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type DesignRequest } from '../../api/client'
import { useCaptureDesign, useDesign, useMe, useSaveDesign } from '../../api/hooks'
import { DesignView } from './DesignView'

// Container: binds the design table to the view and saves one row at a time. Saves for the same requirement run one after the other,
// each against the version the earlier one produced, so tabbing from the link to the notes cannot make the second save a conflict.
// When a new link is saved on a row that has no picture of its own (none, or an earlier capture), the server takes a thumbnail from
// it straight away; a picture someone uploaded is never replaced on its own.
export function DesignPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const queryClient = useQueryClient()
  const design = useDesign(projectId)
  const me = useMe()
  const save = useSaveDesign(projectId)
  const capture = useCaptureDesign(projectId)
  const [capturing, setCapturing] = useState<ReadonlySet<string>>(new Set())
  const [captureErrors, setCaptureErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | undefined>()
  const [savedAt, setSavedAt] = useState<string | undefined>()
  const [pending, setPending] = useState(0)
  const chain = useRef(new Map<string, Promise<unknown>>())

  const noBoard = design.error instanceof ApiRequestError && design.error.code === 'no_board'
  const state = noBoard ? 'empty' : design.isError ? 'error' : design.isPending ? 'loading' : 'ready'

  const cached = (storyId: string) => queryClient.getQueryData<{ items: { storyId: string; version: number; prototypeUrl: string | null }[] }>(['design', projectId])?.items.find((i) => i.storyId === storyId)

  // Runs after anything already saving for the same requirement, so the capture sees the link that was just saved.
  const onCapture = (storyId: string, replace: boolean) => {
    const run = async () => {
      setCapturing((c) => new Set(c).add(storyId))
      setCaptureErrors((e) => ({ ...e, [storyId]: '' }))
      try {
        await capture.mutateAsync({ storyId, replace })
      } catch (err) {
        // The link changed while the page was loading: the newer save starts its own capture.
        if (!(err instanceof ApiRequestError && err.code === 'link_changed')) setCaptureErrors((e) => ({ ...e, [storyId]: friendlyMessage(err) }))
      } finally {
        setCapturing((c) => {
          const n = new Set(c)
          n.delete(storyId)
          return n
        })
      }
    }
    const next = (chain.current.get(storyId) ?? Promise.resolve()).then(run)
    chain.current.set(storyId, next)
    return next
  }

  const onSave = (storyId: string, body: DesignRequest) => {
    setError(undefined)
    setPending((n) => n + 1)
    const run = async () => {
      const before = cached(storyId)
      const version = before?.version ?? 0
      try {
        const saved = await save.mutateAsync({ storyId, version, body })
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
        const linkChanged = !!saved.prototypeUrl && saved.prototypeUrl !== (before?.prototypeUrl ?? null)
        if (linkChanged && design.data?.captureEnabled && (!saved.hasImage || saved.imageSource === 'capture')) void onCapture(storyId, false)
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'version_conflict') {
          await queryClient.invalidateQueries({ queryKey: ['design', projectId] })
          setError('Someone else changed this row, so the table has been reloaded. Your last change was not saved: enter it again.')
        } else {
          setError(friendlyMessage(err))
        }
      } finally {
        setPending((n) => n - 1)
      }
    }
    const next = (chain.current.get(storyId) ?? Promise.resolve()).then(run)
    chain.current.set(storyId, next)
    return next
  }

  return (
    <DesignView
      state={state}
      design={design.data}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      saving={pending > 0}
      savedAt={savedAt}
      errorText={design.isError && !noBoard ? friendlyMessage(design.error) : error}
      openKey={params.get('open')}
      onSave={onSave}
      capturing={capturing}
      captureErrors={captureErrors}
      onCapture={onCapture}
      onGoRequirements={() => navigate(`/projects/${projectId}/requirements`)}
      onViewStory={(key) => navigate(`/projects/${projectId}/stories?open=${encodeURIComponent(key)}`)}
    />
  )
}
