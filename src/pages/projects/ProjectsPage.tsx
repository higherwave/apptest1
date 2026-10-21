import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMe, useProjects } from '../../api/hooks'
import { ProjectsView } from './ProjectsView'

// Container: binds the projects and me operations to the view and decides which state to show.
export function ProjectsPage() {
  const navigate = useNavigate()
  const projects = useProjects()
  const me = useMe()

  const state = projects.isPending ? 'loading' : projects.isError ? 'error' : projects.data.length === 0 ? 'empty' : 'ready'

  return (
    <ProjectsView
      state={state}
      projects={projects.data ?? []}
      errorText={projects.isError ? friendlyMessage(projects.error) : undefined}
      readOnly={me.data?.role === 'viewer'}
      // Same rule as the prototype: an analyzed project opens on its themes, a draft on its plan.
      onOpen={(p) => navigate(`/projects/${p.id}/${p.status === 'analyzed' ? 'themes' : 'plan'}`)}
      onNew={() => navigate('/projects/new')}
    />
  )
}
