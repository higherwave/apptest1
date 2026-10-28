import { useNavigate, useSearchParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useInsightsThemes, usePlatformTheme } from '../../api/hooks'
import { InsightThemesView } from './InsightThemesView'

// Container: the cross-project themes. The selected theme lives in the address (?theme=), so a case study can link to one.
export function InsightThemesPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const overview = useInsightsThemes()
  const themes = overview.data?.themes ?? []
  const asked = params.get('theme')
  const selectedId = themes.some((t) => t.id === asked) ? asked : (themes[0]?.id ?? null)
  const detail = usePlatformTheme(selectedId)

  const state = overview.isError ? 'error' : overview.isPending ? 'loading' : themes.length === 0 ? 'empty' : 'ready'
  return (
    <InsightThemesView
      state={state}
      overview={overview.data}
      selectedId={selectedId}
      detail={detail.data}
      detailFailed={detail.isError}
      errorText={overview.isError ? friendlyMessage(overview.error) : undefined}
      onSelect={(id) => setParams({ theme: id }, { replace: true })}
      onOpenTranscripts={(projectId) => navigate(`/projects/${projectId}/transcripts`)}
      onOpenStep={(projectId, step) => navigate(`/projects/${projectId}/${step}`)}
    />
  )
}
