import { useMemo, useState } from 'react'
import { friendlyMessage, type AuditGroup } from '../../api/client'
import { useAudit, useTeams } from '../../api/hooks'
import { AuditLogView } from './AuditLogView'
import { sinceFor, type AuditRange } from './auditText'

// Container: the audit log, one kind of change at a time, a page at a time.
export function AuditLogPage() {
  const [group, setGroup] = useState<AuditGroup | 'all'>('all')
  const [team, setTeam] = useState('all')
  const [range, setRange] = useState<AuditRange>('all')
  // Worked out when the range is chosen, so the list does not reload every time the clock moves.
  const since = useMemo(() => sinceFor(range), [range])
  const teams = useTeams()
  const audit = useAudit(group === 'all' ? undefined : group, team === 'all' ? undefined : team, since)
  const state = audit.isError ? 'error' : audit.isPending ? 'loading' : 'ready'
  return (
    <AuditLogView
      state={state}
      entries={audit.data?.pages.flatMap((p) => p.data) ?? []}
      group={group}
      teams={teams.data?.data.map((t) => ({ id: t.id, name: t.name })) ?? []}
      team={team}
      onTeam={setTeam}
      range={range}
      onRange={setRange}
      errorText={audit.isError ? friendlyMessage(audit.error) : undefined}
      hasMore={!!audit.hasNextPage}
      loadingMore={audit.isFetchingNextPage}
      onGroup={setGroup}
      onMore={() => audit.fetchNextPage()}
    />
  )
}
