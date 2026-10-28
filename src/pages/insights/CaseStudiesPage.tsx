import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useCaseBriefs, useCaseStudies } from '../../api/hooks'
import { CaseStudiesView } from './CaseStudiesView'

// Container: a row for each analysed project (its brief) and for each case study written by hand. A theme chip opens that theme.
export function CaseStudiesPage() {
  const navigate = useNavigate()
  const cases = useCaseStudies()
  const briefs = useCaseBriefs()
  const error = cases.error ?? briefs.error
  const state = cases.isError || briefs.isError ? 'error' : cases.isPending || briefs.isPending ? 'loading' : (cases.data ?? []).length + (briefs.data ?? []).length === 0 ? 'empty' : 'ready'
  return (
    <CaseStudiesView
      state={state}
      cases={cases.data ?? []}
      briefs={briefs.data ?? []}
      errorText={error ? friendlyMessage(error) : undefined}
      onCopy={(text) => navigator.clipboard.writeText(text).then(() => true, () => false)}
      onOpenTheme={(id) => navigate(`/insights/themes?theme=${id}`)}
    />
  )
}
