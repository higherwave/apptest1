import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useMe } from '../../api/hooks'

// Who may open which Settings page: viewers none (they go back to the projects), editors only Experience Categories, owners all.
export function SettingsGate() {
  const me = useMe()
  const { pathname } = useLocation()
  if (!me.data) return null
  const role = me.data.role
  if (role !== 'owner' && role !== 'editor') return <Navigate to="/projects" replace />
  if (role !== 'owner' && (pathname === '/settings/status' || pathname === '/settings/members')) return <Navigate to="/settings/categories" replace />
  return <Outlet />
}
