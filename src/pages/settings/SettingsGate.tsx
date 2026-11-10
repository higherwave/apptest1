import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useMe } from '../../api/hooks'

// Who may open which Admin page: viewers none (they go back to the projects), editors Experience Categories and Notifications, owners all.
export function SettingsGate() {
  const me = useMe()
  const { pathname } = useLocation()
  if (!me.data) return null
  const role = me.data.role
  if (role !== 'owner' && role !== 'editor') return <Navigate to="/projects" replace />
  if (role !== 'owner' && (pathname === '/settings/status' || pathname === '/settings/usage' || pathname === '/settings/members' || pathname === '/settings/audit')) return <Navigate to="/settings/categories" replace />
  return <Outlet />
}
