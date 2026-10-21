import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createSpec, createStandaloneSpec, deleteSpec, friendlyMessage, type SpecSummary } from '../../api/client'
import { useMe, useProject, useSpecs } from '../../api/hooks'
import { RequirementsList } from './RequirementsList'

// Container: this project's documents and the stand-alone ones; starting a document opens its writer.
export function RequirementsListPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const project = useProject(projectId)
  const mine = useSpecs({ projectId })
  const standalone = useSpecs({ standalone: true })
  const me = useMe()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [removing, setRemoving] = useState<SpecSummary | null>(null)
  const [removeError, setRemoveError] = useState<string | undefined>()

  const open = (s: SpecSummary) => navigate(s.standalone ? `/requirements/${s.id}` : `/projects/${s.projectId}/requirements/${s.id}`)
  const start = async (make: () => Promise<{ id: string; projectId: string; standalone: boolean }>) => {
    setBusy(true)
    setError(undefined)
    try {
      const spec = await make()
      await queryClient.invalidateQueries({ queryKey: ['specs'] })
      navigate(spec.standalone ? `/requirements/${spec.id}` : `/projects/${spec.projectId}/requirements/${spec.id}`, { state: { fresh: true } })
    } catch (err) {
      setError(friendlyMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const state = project.isError || mine.isError || standalone.isError ? 'error' : project.isPending || mine.isPending || standalone.isPending ? 'loading' : 'ready'
  const failure = mine.isError ? mine.error : project.isError ? project.error : standalone.isError ? standalone.error : undefined

  return (
    <RequirementsList
      state={state}
      project={project.data}
      specs={mine.data ?? []}
      standalone={standalone.data ?? []}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      busy={busy}
      errorText={failure ? friendlyMessage(failure) : error}
      removing={removing}
      removeError={removeError}
      onOpen={open}
      onNew={() => start(() => createSpec(projectId))}
      onNewStandalone={(name, what) => start(() => createStandaloneSpec(name, what))}
      onRemove={(s) => {
        setRemoveError(undefined)
        setRemoving(s)
      }}
      onCancelRemove={() => setRemoving(null)}
      // A hard delete, after the confirmation: the lists refresh once the API has deleted it.
      onConfirmRemove={async () => {
        if (!removing) return
        try {
          await deleteSpec(removing.id)
          setRemoving(null)
          await queryClient.invalidateQueries({ queryKey: ['specs'] })
          await queryClient.invalidateQueries({ queryKey: ['stage', projectId] })
        } catch (err) {
          setRemoveError(friendlyMessage(err))
        }
      }}
      onBack={() => navigate('/projects')}
    />
  )
}
