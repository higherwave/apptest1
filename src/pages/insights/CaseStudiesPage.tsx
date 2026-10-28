import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useCaseBrief, useCaseStudies, useInsightsThemes } from '../../api/hooks'
import { CaseStudiesView } from './CaseStudiesView'

// Container: the case studies, and a quick brief for any analysed project. A theme chip opens that theme on the Themes screen.
export function CaseStudiesPage() {
  const navigate = useNavigate()
  const cases = useCaseStudies()
  const overview = useInsightsThemes()
  const [projectId, setProjectId] = useState<string | null>(null)
  const brief = useCaseBrief(projectId)
  const state = cases.isError ? 'error' : cases.isPending ? 'loading' : (cases.data ?? []).length === 0 ? 'empty' : 'ready'
  return (
    <CaseStudiesView
      state={state}
      cases={cases.data ?? []}
      errorText={cases.isError ? friendlyMessage(cases.error) : undefined}
      projects={overview.data?.projects ?? []}
      projectId={projectId}
      brief={brief.data}
      briefLoading={!!projectId && brief.isPending}
      briefFailed={brief.isError}
      onPickProject={setProjectId}
      onCopy={(text) => navigator.clipboard.writeText(text).then(() => true, () => false)}
      onOpenTheme={(id) => navigate(`/insights/themes?theme=${id}`)}
    />
  )
}
