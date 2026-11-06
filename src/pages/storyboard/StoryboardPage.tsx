import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useGenerateStoryboard, useMe, useProject, useStoryboard } from '../../api/hooks'
import { StoryboardView } from './StoryboardView'

// Container: the project's storyboard. Reading is open to everyone; owners and editors write it (or write it again).
export function StoryboardPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const me = useMe()
  const board = useStoryboard(projectId)
  const generate = useGenerateStoryboard(projectId)
  // A generate returns the new storyboard, which is also what the page then shows.
  const shown = generate.data ?? board.data
  const state = board.isError ? 'error' : board.isPending ? 'loading' : shown && shown.facts.themes.length === 0 ? 'empty' : shown?.draft ? 'ready' : 'ungenerated'
  return (
    <StoryboardView
      state={state}
      project={project.data}
      board={shown}
      author={me.data?.displayName ?? ''}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      generating={generate.isPending}
      errorText={board.isError ? friendlyMessage(board.error) : generate.isError ? friendlyMessage(generate.error) : undefined}
      fallback={generate.data?.fallback}
      onGenerate={() => generate.mutate()}
      onGoTranscripts={() => navigate(`/projects/${projectId}/transcripts`)}
      onAllThemes={() => navigate(`/projects/${projectId}/themes`)}
    />
  )
}
