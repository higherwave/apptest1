import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiRequestError, friendlyMessage, type MeasureRequest } from '../../api/client'
import { useMeasureAcross, useSaveMeasure } from '../../api/hooks'
import { MeasureView } from './MeasureView'

// Container: Measure across projects. The team and project it is narrowed to live in the address (?team=, ?project=), so a link from a project or a
// story lands on the right rows (?open=R1 opens one requirement). Saves for the same requirement run one after the other, each against the version
// the earlier one produced, so leaving one field for the next cannot make the second save a conflict.
export function MeasurePage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const measure = useMeasureAcross()
  const save = useSaveMeasure()
  const [error, setError] = useState<string | undefined>()
  const [savedAt, setSavedAt] = useState<string | undefined>()
  const [pending, setPending] = useState(0)
  const chain = useRef(new Map<string, Promise<unknown>>())

  const data = measure.data
  const state = measure.isError ? 'error' : measure.isPending ? 'loading' : data && data.projects.length === 0 ? 'empty' : 'ready'
  // A team or project in the address that is not in the list (a stale link) is ignored rather than showing an empty page.
  const team = data?.projects.some((p) => p.teamId === params.get('team')) ? params.get('team') : null
  const project = data?.projects.some((p) => p.id === params.get('project')) ? params.get('project') : null
  const setFilter = (next: { team?: string | null; project?: string | null }) => {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v)
      else p.delete(k)
    }
    // Choosing a team drops a project that is not in it; any filter change drops the opened requirement.
    p.delete('open')
    setParams(p, { replace: true })
  }

  const onSave = (storyId: string, body: MeasureRequest) => {
    setError(undefined)
    setPending((n) => n + 1)
    const run = async () => {
      const version = queryClient.getQueryData<{ items: { storyId: string; version: number }[] }>(['measure'])?.items.find((i) => i.storyId === storyId)?.version ?? 0
      try {
        await save.mutateAsync({ storyId, version, body })
        setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'version_conflict') {
          await queryClient.invalidateQueries({ queryKey: ['measure'] })
          setError('Someone else changed this row, so the list has been reloaded. Your last change was not saved: enter it again.')
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
      data={data}
      team={team}
      project={project}
      openKey={params.get('open')}
      saving={pending > 0}
      savedAt={savedAt}
      errorText={measure.isError ? friendlyMessage(measure.error) : error}
      onTeam={(id) => setFilter({ team: id, project: null })}
      onProject={(id) => setFilter({ project: id })}
      onSave={onSave}
      onGoProjects={() => navigate('/projects')}
      onViewStory={(projectId, key) => navigate(`/projects/${projectId}/stories?open=${encodeURIComponent(key)}`)}
    />
  )
}
