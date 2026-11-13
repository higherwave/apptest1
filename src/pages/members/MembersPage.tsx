import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { friendlyMessage, type Member, type MemberRole } from '../../api/client'
import { useChangeMemberRole, useInviteMember, useMe, useMembers, useRemoveMember, useSetMemberExternal } from '../../api/hooks'
import { ReviewersPage } from '../reviewers/ReviewersPage'
import { MembersView } from './MembersView'

// Container: the members, the invite form's state, and the owner-only changes.
export function MembersPage() {
  const me = useMe()
  const members = useMembers()
  const invite = useInviteMember()
  const change = useChangeMemberRole()
  const remove = useRemoveMember()
  const setExternal = useSetMemberExternal()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'reviewers' ? 1 : 0
  const [external, setExternal2] = useState(false)
  const [removing, setRemoving] = useState<Member | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<MemberRole>('editor')
  const [notice, setNotice] = useState<string | undefined>()

  const failure = [invite, change, remove, setExternal].find((m) => m.isError)?.error
  const state = members.isPending ? 'loading' : members.isError ? 'error' : 'ready'

  return (
    <MembersView
      state={state}
      members={members.data?.data ?? []}
      myEmail={me.data?.email}
      isOwner={me.data?.role === 'owner' && !me.data.rolesManagedBySso}
      managedBySso={!!me.data?.rolesManagedBySso}
      errorText={members.isError ? friendlyMessage(members.error) : failure ? friendlyMessage(failure) : undefined}
      notice={notice}
      email={email}
      role={role}
      external={external}
      tab={tab}
      onTab={(next) => setParams(next === 1 ? { tab: 'reviewers' } : {}, { replace: true })}
      reviewers={<ReviewersPage />}
      inviting={invite.isPending}
      removing={removing}
      removePending={remove.isPending}
      onEmail={setEmail}
      onRole={setRole}
      onExternal={setExternal2}
      onToggleExternal={(m, v) => {
        setNotice(undefined)
        setExternal.mutate({ id: m.id, external: v })
      }}
      onInvite={() => {
        setNotice(undefined)
        invite.mutate({ email, role: external ? 'viewer' : role, external }, { onSuccess: (m) => { setEmail(''); setExternal2(false); setNotice(`${m.email} is invited as ${m.external ? 'an external viewer' : m.role}. They sign in with that account.`) } })
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
