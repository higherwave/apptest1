import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { usePlatformJourney } from '../../api/hooks'
import { PlatformJourneyView } from './PlatformJourneyView'

// Container: the platform journey; a theme opens on the Themes screen.
export function PlatformJourneyPage() {
  const navigate = useNavigate()
  const journey = usePlatformJourney()
  const state = journey.isError ? 'error' : journey.isPending ? 'loading' : (journey.data?.stages ?? []).length === 0 ? 'empty' : 'ready'
  return <PlatformJourneyView state={state} journey={journey.data} errorText={journey.isError ? friendlyMessage(journey.error) : undefined} onOpenTheme={(id) => navigate(`/insights/themes?theme=${id}`)} />
}
