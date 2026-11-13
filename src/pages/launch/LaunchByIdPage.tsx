import { useParams } from 'react-router-dom'
import { LaunchScreen } from './LaunchScreen'

// A launch opened by its address: how a reviewer from another team, or an external reviewer, reaches it.
export function LaunchByIdPage() {
  const { launchId = '' } = useParams()
  return <LaunchScreen launchId={launchId} />
}
