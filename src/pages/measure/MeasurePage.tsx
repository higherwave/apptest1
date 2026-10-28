import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type MeasureRequest } from '../../api/client'
import { useMe, useMeasure, useSaveMeasure } from '../../api/hooks'
import { MeasureView } from './MeasureView'

// Container: binds the measures to the view and saves one requirement at a time. Saves for the same requirement run one after the
// other, each against the version the earlier one produced, so leaving one field for the next cannot make the second save a conflict.
export function MeasurePage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const measure = useMeasure(projectId)
  const me = useMe()
  const save = useSaveMeasure(projectId)
  const [error, setError] = useState<string | undefined>()
  const [savedAt, setSavedAt] = useState<string | undefined>()
  const [pending, setPending] = useState(0)
  const chain = useRef(new Map<string, Promise<unknown>>())

  const noBoard = measure.error instanceof ApiRequestError && measure.error.code === 'no_board'
  const state = noBoard ? 'empty' : measure.isError ? 'error' : measure.isPending ? 'loading' : 'ready'

  const onSave = (storyId: string, body: MeasureRequest) => {
    setError(undefined)
    setPending((n) => n + 1)
    const run = async () => {
      const version = queryClient.getQueryData<{ items: { storyId: string; version: number }[] }>(['measure', projectId])?.items.find((i) => i.storyId === storyId)?.version ?? 0
      try {
        await save.mutateAsync({ storyId, version, body })
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'version_conflict') {
          await queryClient.invalidateQueries({ queryKey: ['measure', projectId] })
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
    <MeasureView
      state={state}
      measure={measure.data}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      saving={pending > 0}
      savedAt={savedAt}
      errorText={measure.isError && !noBoard ? friendlyMessage(measure.error) : error}
      onSave={onSave}
      onGoRequirements={() => navigate(`/projects/${projectId}/requirements`)}
      onViewStory={(key) => navigate(`/projects/${projectId}/stories?open=${encodeURIComponent(key)}`)}
    />
  )
}
