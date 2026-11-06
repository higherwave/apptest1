import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMe, useProject } from '../../api/hooks'
import { PrioritiesView } from './PrioritiesView'
import { useThemeData } from './useThemeData'

// Container: edits to importance and effort go straight to the API; "Reset all" clears them for the project.
export function PrioritiesPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const me = useMe()
  const data = useThemeData(projectId)
  const state = data.themes.isError ? 'error' : data.themes.isPending ? 'loading' : data.list.length === 0 ? 'empty' : 'ready'
  return (
    <PrioritiesView
      state={state}
      project={project.data}
      themes={data.list}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      pending={data.pending}
      errorText={data.themes.isError ? friendlyMessage(data.themes.error) : data.error}
      onEdit={data.edit}
      onResetAll={data.resetAll}
      onGoTranscripts={() => navigate(`/projects/${projectId}/transcripts`)}
    />
  )
}
