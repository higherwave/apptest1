import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { createSpec, friendlyMessage, type SpecSummary } from '../../api/client'
import { useMe, useProject, useSpecs } from '../../api/hooks'
import { RequirementsEntry } from './RequirementsEntry'

// The one document of a project: the published one if there is one, otherwise the oldest (the API picks the same).
const pick = (specs: SpecSummary[]) => specs.find((s) => s.status === 'published') ?? [...specs].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]

// Container: a project has one requirements document. If it exists this opens it; otherwise, for an editor, it is drafted now
// from the project's themes (asking again is harmless: the API returns the existing one).
export function RequirementsEntryPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const project = useProject(projectId)
  const mine = useSpecs({ projectId })
  const me = useMe()
  const [error, setError] = useState<string | undefined>()
  const [drafting, setDrafting] = useState(false)
  const asked = useRef(false)

  const existing = mine.data ? pick(mine.data) : undefined
  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'
  const analyzed = project.data?.status === 'analyzed'
  const ready = project.isSuccess && mine.isSuccess && me.isSuccess

  const begin = async () => {
    setError(undefined)
    setDrafting(true)
    try {
      const spec = await createSpec(projectId)
      await queryClient.invalidateQueries({ queryKey: ['specs'] })
      navigate(`/projects/${spec.projectId}/requirements/${spec.id}`, { replace: true, state: { fresh: true } })
    } catch (err) {
      setError(friendlyMessage(err))
      setDrafting(false)
    }
  }

  useEffect(() => {
    if (ready && !existing && analyzed && canEdit && !asked.current) {
      asked.current = true
      void begin()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, existing, analyzed, canEdit])

  if (existing) return <Navigate replace to={`/projects/${existing.projectId}/requirements/${existing.id}`} />

  const failure = project.isError ? project.error : mine.isError ? mine.error : undefined
  const state = failure || error ? 'error' : !ready ? 'loading' : !analyzed ? 'not_analyzed' : !canEdit ? 'not_started' : 'drafting'

  return (
    <RequirementsEntry
      state={drafting && !error ? 'drafting' : state}
      project={project.data}
      errorText={failure ? friendlyMessage(failure) : error}
      onRetry={() => void begin()}
      onGoToTranscripts={() => navigate(`/projects/${projectId}/transcripts`)}
    />
  )
}
