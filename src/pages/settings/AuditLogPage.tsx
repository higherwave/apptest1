import { useState } from 'react'
import { friendlyMessage, type AuditGroup } from '../../api/client'
import { useAudit, useTeams } from '../../api/hooks'
import { AuditLogView } from './AuditLogView'

// Container: the audit log, one kind of change at a time, a page at a time.
export function AuditLogPage() {
  const [group, setGroup] = useState<AuditGroup | 'all'>('all')
  const [team, setTeam] = useState('all')
  const teams = useTeams()
  const audit = useAudit(group === 'all' ? undefined : group, team === 'all' ? undefined : team)
  const state = audit.isError ? 'error' : audit.isPending ? 'loading' : 'ready'
  return (
    <AuditLogView
      state={state}
      entries={audit.data?.pages.flatMap((p) => p.data) ?? []}
      group={group}
      teams={teams.data?.data.map((t) => ({ id: t.id, name: t.name })) ?? []}
      team={team}
      onTeam={setTeam}
      errorText={audit.isError ? friendlyMessage(audit.error) : undefined}
      hasMore={!!audit.hasNextPage}
      loadingMore={audit.isFetchingNextPage}
      onGroup={setGroup}
      onMore={() => audit.fetchNextPage()}
    />
  )
}
