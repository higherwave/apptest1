import { useNavigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useCustomers } from '../../api/hooks'
import { useGrouping } from './GroupBy'
import { CustomersView } from './CustomersView'

// Container: customer profiles; a theme opens on the Themes screen and a quote opens the transcript it came from.
export function CustomersPage() {
  const navigate = useNavigate()
  const customers = useCustomers()
  const [groupBy, setGroupBy] = useGrouping()
  const state = customers.isError ? 'error' : customers.isPending ? 'loading' : (customers.data?.groups ?? []).length === 0 ? 'empty' : 'ready'
  return (
    <CustomersView
      state={state}
      customers={customers.data}
      groupBy={groupBy}
      onGroupBy={setGroupBy}
      errorText={customers.isError ? friendlyMessage(customers.error) : undefined}
      onOpenTheme={(id) => navigate(`/insights/themes?theme=${id}`)}
      onOpenTranscripts={(projectId) => navigate(`/projects/${projectId}/transcripts`)}
    />
  )
}
