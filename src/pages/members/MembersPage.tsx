import { useState } from 'react'
import { friendlyMessage, type Member, type MemberRole } from '../../api/client'
import { useChangeMemberRole, useInviteMember, useMe, useMembers, useRemoveMember } from '../../api/hooks'
import { MembersView } from './MembersView'

// Container: the members, the invite form's state, and the owner-only changes.
export function MembersPage() {
  const me = useMe()
  const members = useMembers()
  const invite = useInviteMember()
  const change = useChangeMemberRole()
  const remove = useRemoveMember()
  const [removing, setRemoving] = useState<Member | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('editor')
  const [notice, setNotice] = useState<string | undefined>()

  const failure = [invite, change, remove].find((m) => m.isError)?.error
  const state = members.isPending ? 'loading' : members.isError ? 'error' : 'ready'

  return (
    <MembersView
      state={state}
      members={members.data?.data ?? []}
      myEmail={me.data?.email}
      isOwner={me.data?.role === 'owner'}
      errorText={members.isError ? friendlyMessage(members.error) : failure ? friendlyMessage(failure) : undefined}
      notice={notice}
      email={email}
      role={role}
      inviting={invite.isPending}
      removing={removing}
      removePending={remove.isPending}
      onEmail={setEmail}
      onRole={setRole}
      onInvite={() => {
        setNotice(undefined)
        invite.mutate({ email, role }, { onSuccess: (m) => { setEmail(''); setNotice(`${m.email} is invited as ${m.role}. They sign in with that Google account.`) } })
      }}
      onChangeRole={(m, next) => {
        setNotice(undefined)
        change.mutate({ id: m.id, role: next })
      }}
      onAskRemove={(m) => setRemoving(m)}
      onCancelRemove={() => setRemoving(null)}
      onConfirmRemove={() => {
        if (!removing) return
        setNotice(undefined)
        remove.mutate(removing.id, { onSettled: () => setRemoving(null) })
      }}
    />
  )
}
