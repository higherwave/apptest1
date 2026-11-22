import { useEffect } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useMe } from '../../api/hooks'

// Who may open which Settings page: viewers none (they go back to the projects), editors Experience Categories and Notifications, owners all.
export function SettingsGate() {
  const me = useMe()
  const { pathname } = useLocation()
  // Moving between Settings sections opens the next one at the top, not wherever the last one was scrolled to (its tabs would sit under the fixed header).
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pathname])
  if (!me.data) return null
  const role = me.data.role
  if (role !== 'owner' && role !== 'editor') return <Navigate to="/projects" replace />
  if (role !== 'owner' && (pathname === '/settings/status' || pathname === '/settings/usage' || pathname === '/settings/access' || pathname === '/settings/people' || pathname === '/settings/members' || pathname === '/settings/approvals' || pathname === '/settings/teams' || pathname === '/settings/data' || pathname === '/settings/audit' || pathname === '/settings/pulse' || pathname === '/settings/preview')) return <Navigate to="/settings/categories" replace />
  return <Outlet />
}
