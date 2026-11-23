import { useSearchParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMeasureResults } from '../../api/hooks'
import { MeasureView, type Result } from './MeasureView'

const RESULTS = ['worked', 'needs_attention', 'too_early']

// Container: Measure, the results across projects. The team, owner and result it is narrowed to live in the address (?team=, ?owner=, ?result=).
export function MeasurePage() {
  const [params, setParams] = useSearchParams()
  const results = useMeasureResults()
  const data = results.data
  const state = results.isError ? 'error' : results.isPending ? 'loading' : data && data.themes.length === 0 ? 'empty' : 'ready'
  const projects = data ? data.themes.flatMap((t) => t.projects) : []
  // A team or owner in the address that is not in the list (a stale link) is ignored rather than showing an empty page.
  const team = projects.some((p) => p.teamId === params.get('team')) ? params.get('team') : null
  const owner = projects.some((p) => p.ownerId === params.get('owner')) ? params.get('owner') : null
  const result = RESULTS.includes(params.get('result') ?? '') ? (params.get('result') as Result) : null
  const set = (key: string, value: string | null) => {
    const p = new URLSearchParams(params)
    if (value) p.set(key, value)
    else p.delete(key)
    setParams(p, { replace: true })
  }
  return <MeasureView state={state} data={data} team={team} owner={owner} result={result} errorText={results.isError ? friendlyMessage(results.error) : undefined} onTeam={(id) => set('team', id)} onOwner={(id) => set('owner', id)} onResult={(r) => set('result', r)} onCopy={(text) => navigator.clipboard.writeText(text).then(() => true, () => false)} />
}
