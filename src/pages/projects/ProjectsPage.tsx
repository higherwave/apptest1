import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage, type Project } from '../../api/client'
import { useDeleteProject, useMe, useProjects } from '../../api/hooks'
import { ProjectsView } from './ProjectsView'

// Container: binds the projects and me operations to the view and decides which state to show.
export function ProjectsPage() {
  const navigate = useNavigate()
  const projects = useProjects()
  const me = useMe()
  const remove = useDeleteProject()
  const [removing, setRemoving] = useState<Project | null>(null)
  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'

  const state = projects.isPending ? 'loading' : projects.isError ? 'error' : projects.data.length === 0 ? 'empty' : 'ready'

  return (
    <ProjectsView
      state={state}
      projects={projects.data ?? []}
      errorText={projects.isError ? friendlyMessage(projects.error) : undefined}
      readOnly={!canEdit}
      // Same rule as the prototype: an analyzed project opens on its themes, a draft on its plan.
      onOpen={(p) => navigate(`/projects/${p.id}/${p.status === 'analyzed' ? 'themes' : 'plan'}`)}
      onGo={(p, step) => navigate(`/projects/${p.id}/${step}`)}
      onNew={() => navigate('/projects/new')}
      onRemove={canEdit ? setRemoving : undefined}
      removing={removing}
      removePending={remove.isPending}
      removeError={remove.isError ? friendlyMessage(remove.error) : undefined}
      onCancelRemove={() => {
        setRemoving(null)
        remove.reset()
      }}
      // A hard delete, after the confirmation dialog: the list refreshes once the API has deleted it.
      onConfirmRemove={() => removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
    />
  )
}
