import { Navigate, useLocation, useParams } from 'react-router-dom'

// Measure used to be a step of each project. An old address (a bookmark, a link in an email) lands on Measure narrowed to that project.
export function MeasureOfProject() {
  const { projectId = '' } = useParams()
  const { search } = useLocation()
  const open = new URLSearchParams(search).get('open')
  return <Navigate to={`/measure?project=${encodeURIComponent(projectId)}${open ? `&open=${encodeURIComponent(open)}` : ''}`} replace />
}
