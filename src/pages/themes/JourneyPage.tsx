import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMapProjectStage, useMe, useProject, useProjectBlueprint, useSetProjectWorkflow, useWorkflows } from '../../api/hooks'
import { JourneyView } from './JourneyView'
import { useThemeData } from './useThemeData'

// Container: the same themes as the Themes screen, so an edit there shows here without another request.
export function JourneyPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const me = useMe()
  const data = useThemeData(projectId)
  const blueprint = useProjectBlueprint(projectId)
  const workflows = useWorkflows()
  const setWorkflow = useSetProjectWorkflow(projectId)
  const mapStage = useMapProjectStage(projectId)
  const blueprintFailure = [setWorkflow, mapStage].find((m) => m.isError)?.error
  const state = data.themes.isError ? 'error' : data.themes.isPending ? 'loading' : data.list.length === 0 ? 'empty' : 'ready'
  return (
    <JourneyView
      state={state}
      project={project.data}
      stages={data.stages}
      themes={data.list}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      pending={data.pending}
      errorText={data.themes.isError ? friendlyMessage(data.themes.error) : (data.error ?? (blueprintFailure ? friendlyMessage(blueprintFailure) : undefined))}
      blueprint={blueprint.data}
      workflows={workflows.data?.data ?? []}
      onSetWorkflow={(id) => setWorkflow.mutate(id)}
      onMapStage={(position, workflowStageId) => mapStage.mutate({ position, workflowStageId })}
      onEdit={data.edit}
      onGoTranscripts={() => navigate(`/projects/${projectId}/transcripts`)}
    />
  )
}
