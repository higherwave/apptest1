import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useCaseStudies } from '../../api/hooks'
import { CaseStudiesView } from './CaseStudiesView'

// Container: the case studies; a theme chip opens that theme on the Themes screen.
export function CaseStudiesPage() {
  const navigate = useNavigate()
  const cases = useCaseStudies()
  const state = cases.isError ? 'error' : cases.isPending ? 'loading' : (cases.data ?? []).length === 0 ? 'empty' : 'ready'
  return (
    <CaseStudiesView
      state={state}
      cases={cases.data ?? []}
      errorText={cases.isError ? friendlyMessage(cases.error) : undefined}
      onOpenTheme={(id) => navigate(`/insights/themes?theme=${id}`)}
    />
  )
}
