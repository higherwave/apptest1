import { useState } from 'react'
import { friendlyMessage } from '../../api/client'
import { useCreateTeam, useDeleteTeam, useMe, useMembers, useSaveTeam, useTeams } from '../../api/hooks'
import { TeamsView } from './TeamsView'

// Container: the teams, the panel that is open, and the owner-only changes.
export function TeamsPage() {
  const me = useMe()
  const teams = useTeams()
  const members = useMembers()
  const create = useCreateTeam()
  const save = useSaveTeam()
  const del = useDeleteTeam()
  const [panel, setPanel] = useState<{ type: 'new' } | { type: 'team'; id: string } | null>(null)
  const [notice, setNotice] = useState<string | undefined>()
  const mutation = [create, save, del].find((m) => m.isError)
  const reset = () => { create.reset(); save.reset(); del.reset() }
  const open = (next: typeof panel) => { setNotice(undefined); reset(); setPanel(next) }

  return (
    <TeamsView
      state={teams.isPending || members.isPending ? 'loading' : teams.isError || members.isError ? 'error' : 'ready'}
      teams={teams.data?.data ?? []}
      members={members.data?.data ?? []}
      groupsManage={!!me.data?.teamsManagedBySso}
      errorText={teams.isError ? friendlyMessage(teams.error) : members.isError ? friendlyMessage(members.error) : undefined}
      notice={notice}
      busy={create.isPending || save.isPending || del.isPending}
      panel={panel}
      panelError={mutation ? friendlyMessage(mutation.error) : undefined}
      onNew={() => open({ type: 'new' })}
      onOpen={(id) => open({ type: 'team', id })}
      onClosePanel={() => { setPanel(null); reset() }}
      onCreate={(input) => create.mutate(input, { onSuccess: (t) => { setPanel(null); const n = Object.keys(input.members ?? {}).length; setNotice(`${(t as { name: string }).name} created${n ? ` with ${n} ${n === 1 ? 'person' : 'people'}` : ''}.`) } })}
      onSave={(id, body) => save.mutate({ id, body }, { onSuccess: () => { setPanel(null); setNotice('Changes saved.') } })}
      onDelete={(id) => del.mutate(id, { onSuccess: () => { setPanel(null); setNotice('Team deleted.') } })}
    />
  )
}
