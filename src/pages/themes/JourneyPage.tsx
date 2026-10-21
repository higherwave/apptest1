import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMe, useProject } from '../../api/hooks'
import { JourneyView } from './JourneyView'
import { useThemeData } from './useThemeData'

// Container: the same themes as the Themes screen, so an edit there shows here without another request.
export function JourneyPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const me = useMe()
  const data = useThemeData(projectId)
  const state = data.themes.isError ? 'error' : data.themes.isPending ? 'loading' : data.list.length === 0 ? 'empty' : 'ready'
  return (
    <JourneyView
      state={state}
      project={project.data}
      stages={data.stages}
      themes={data.list}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      pending={data.pending}
      errorText={data.themes.isError ? friendlyMessage(data.themes.error) : data.error}
      onEdit={data.edit}
      onGoTranscripts={() => navigate(`/projects/${projectId}/transcripts`)}
    />
  )
}
