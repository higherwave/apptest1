import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type DesignRequest } from '../../api/client'
import { useDesign, useMe, useSaveDesign } from '../../api/hooks'
import { DesignView } from './DesignView'

// Container: binds the design table to the view and saves one row at a time. Saves for the same requirement run one after the other,
// each against the version the earlier one produced, so tabbing from the link to the notes cannot make the second save a conflict.
export function DesignPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const design = useDesign(projectId)
  const me = useMe()
  const save = useSaveDesign(projectId)
  const [error, setError] = useState<string | undefined>()
  const [savedAt, setSavedAt] = useState<string | undefined>()
  const [pending, setPending] = useState(0)
  const chain = useRef(new Map<string, Promise<unknown>>())

  const noBoard = design.error instanceof ApiRequestError && design.error.code === 'no_board'
  const state = noBoard ? 'empty' : design.isError ? 'error' : design.isPending ? 'loading' : 'ready'

  const onSave = (storyId: string, body: DesignRequest) => {
    setError(undefined)
    setPending((n) => n + 1)
    const run = async () => {
      const version = queryClient.getQueryData<{ items: { storyId: string; version: number }[] }>(['design', projectId])?.items.find((i) => i.storyId === storyId)?.version ?? 0
      try {
        await save.mutateAsync({ storyId, version, body })
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
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
      onSave={onSave}
      onGoRequirements={() => navigate(`/projects/${projectId}/requirements`)}
    />
  )
}
