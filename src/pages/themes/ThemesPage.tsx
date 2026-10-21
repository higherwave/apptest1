import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage, type ThemeCategory } from '../../api/client'
import { useMe, useProject } from '../../api/hooks'
import { ThemesView } from './ThemesView'
import { useThemeData } from './useThemeData'

// Container: binds the themes to the view, holds the filter and the selected theme, and sends edits.
export function ThemesPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const me = useMe()
  const data = useThemeData(projectId)
  const [category, setCategory] = useState<ThemeCategory | 'all'>('all')
  const [picked, setPicked] = useState<string | null>(null)

  // Until the person picks one, the first theme in view is selected.
  const visible = category === 'all' ? data.list : data.list.filter((t) => t.category === category)
  const selectedId = picked && visible.some((t) => t.id === picked) ? picked : (visible[0]?.id ?? null)

  const state = data.themes.isError ? 'error' : data.themes.isPending ? 'loading' : data.list.length === 0 ? 'empty' : 'ready'

  return (
    <ThemesView
      state={state}
      project={project.data}
      themes={data.list}
      stages={data.stages}
      category={category}
      selectedId={selectedId}
      canEdit={me.data?.role === 'owner' || me.data?.role === 'editor'}
      pending={data.pending}
      errorText={data.themes.isError ? friendlyMessage(data.themes.error) : data.error}
      onCategory={setCategory}
      onSelect={setPicked}
      onEdit={data.edit}
      onGoTranscripts={() => navigate(`/projects/${projectId}/transcripts`)}
    />
  )
}
