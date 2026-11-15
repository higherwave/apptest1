import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useChangeMember, useInviteMember, useMe, useMembers, useRemoveMember, useTeams } from '../../api/hooks'
import { PeopleView } from './PeopleView'

// The old Members address: the Reviewers tab is now Approvals, and the rest is People.
export function MembersEntry() {
  const [params] = useSearchParams()
  return <Navigate to={params.get('tab') === 'reviewers' ? '/settings/approvals' : '/settings/people'} replace />
}

// Container: the people, the panel that is open, and the owner-only changes.
export function PeoplePage() {
  const me = useMe()
  const members = useMembers()
  const teams = useTeams()
  const invite = useInviteMember()
  const change = useChangeMember()
  const remove = useRemoveMember()
  const navigate = useNavigate()
  const [panel, setPanel] = useState<{ type: 'invite' } | { type: 'person'; id: string } | null>(null)
  const [notice, setNotice] = useState<string | undefined>()
  const mutation = [invite, change, remove].find((m) => m.isError)
  const close = () => { setPanel(null); invite.reset(); change.reset(); remove.reset() }
  const open = (next: typeof panel) => { setNotice(undefined); invite.reset(); change.reset(); remove.reset(); setPanel(next) }

  return (
    <PeopleView
      state={members.isPending || teams.isPending ? 'loading' : members.isError || teams.isError ? 'error' : 'ready'}
      members={members.data?.data ?? []}
      teams={teams.data?.data ?? []}
      myEmail={me.data?.email}
      rolesManaged={!!me.data?.rolesManagedBySso}
      teamsManaged={!!me.data?.teamsManagedBySso}
      errorText={members.isError ? friendlyMessage(members.error) : teams.isError ? friendlyMessage(teams.error) : undefined}
      notice={notice}
      busy={invite.isPending || change.isPending || remove.isPending}
      panel={panel}
      panelError={mutation ? friendlyMessage(mutation.error) : undefined}
      onInviteOpen={() => open({ type: 'invite' })}
      onPersonOpen={(id) => open({ type: 'person', id })}
      onClosePanel={close}
      onInvite={(input) => invite.mutate(input, { onSuccess: (m) => { setPanel(null); setNotice(`${m.email} is invited as ${m.external ? 'an external viewer' : m.role}. They sign in with that account.`) } })}
      onSavePerson={(id, body) => change.mutate({ id, body }, { onSuccess: () => { setPanel(null); setNotice('Changes saved.') } })}
      onRemove={(id) => remove.mutate(id, { onSuccess: () => { setPanel(null); setNotice('Removed from the workspace.') } })}
      onApprovals={() => navigate('/settings/approvals')}
    />
  )
}
