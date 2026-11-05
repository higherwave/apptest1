import { useState } from 'react'
import { friendlyMessage, type AuditGroup } from '../../api/client'
import { useAudit } from '../../api/hooks'
import { AuditLogView } from './AuditLogView'

// Container: the audit log, one kind of change at a time, a page at a time.
export function AuditLogPage() {
  const [group, setGroup] = useState<AuditGroup | 'all'>('all')
  const audit = useAudit(group === 'all' ? undefined : group)
  const state = audit.isError ? 'error' : audit.isPending ? 'loading' : 'ready'
  return (
    <AuditLogView
      state={state}
      entries={audit.data?.pages.flatMap((p) => p.data) ?? []}
      group={group}
      errorText={audit.isError ? friendlyMessage(audit.error) : undefined}
      hasMore={!!audit.hasNextPage}
      loadingMore={audit.isFetchingNextPage}
      onGroup={setGroup}
      onMore={() => audit.fetchNextPage()}
    />
  )
}
