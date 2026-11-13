import { useState } from 'react'
import { friendlyMessage, type Member, type MemberRole } from '../../api/client'
import { useMe, useCreateTeam, useDeleteTeam, useMembers, useMoveProject, useRemoveTeamMember, useRenameTeam, useReviewers, useSetTeamLaunchSteps, useSetTeamMember, useTeams } from '../../api/hooks'
import { TeamsView } from './TeamsView'

// Container: the teams, which one is open, and the leader-only changes.
export function TeamsPage() {
  const teams = useTeams()
  const me = useMe()
  const members = useMembers()
  const create = useCreateTeam()
  const rename = useRenameTeam()
  const del = useDeleteTeam()
  const setMember = useSetTeamMember()
  const removeMember = useRemoveTeamMember()
  const move = useMoveProject()
  const reviewers = useReviewers()
  const setSteps = useSetTeamLaunchSteps()
  const [pickedId, setPickedId] = useState<string | undefined>()
  const [newName, setNewName] = useState('')
  const [draft, setDraft] = useState<{ id: string; name: string } | null>(null)
  const [addPerson, setAddPerson] = useState<Member | null>(null)
  const [addRole, setAddRole] = useState<MemberRole>('editor')
  const [confirmDelete, setConfirmDelete] = useState(false)

  const list = teams.data?.data ?? []
  const selected = list.find((t) => t.id === pickedId) ?? list[0]
  // The name box follows the open team until the person types in it.
  const nameDraft = draft && draft.id === selected?.id ? draft.name : (selected?.name ?? '')
  const failure = [create, rename, del, setMember, removeMember, move, setSteps].find((m) => m.isError)?.error
  const state = teams.isPending || members.isPending ? 'loading' : teams.isError || members.isError ? 'error' : 'ready'
  const busy = [create, rename, del, setMember, removeMember, move, setSteps].some((m) => m.isPending)
  const stepsOf = reviewers.data?.teams.find((t) => t.id === selected?.id)
  const launchSteps = reviewers.data && stepsOf ? { steps: reviewers.data.steps, off: stepsOf.stepsOff } : undefined

  return (
    <TeamsView
      state={state}
      teams={list}
      people={members.data?.data ?? []}
      selected={selected}
      groupsManage={!!me.data?.teamsManagedBySso}
      errorText={teams.isError ? friendlyMessage(teams.error) : members.isError ? friendlyMessage(members.error) : failure ? friendlyMessage(failure) : undefined}
      newName={newName}
      nameDraft={nameDraft}
      addPerson={addPerson}
      addRole={addRole}
      busy={busy}
      confirmDelete={confirmDelete}
      launchSteps={launchSteps}
      onLaunchStep={(step, used) => selected && setSteps.mutate({ id: selected.id, used: { [step]: used } })}
      onSelect={(id) => {
        setPickedId(id)
        setDraft(null)
        setAddPerson(null)
      }}
      onNewName={setNewName}
      onCreate={() => create.mutate(newName.trim(), { onSuccess: (t) => { setNewName(''); setPickedId((t as { id: string }).id ?? undefined) } })}
      onNameDraft={(name) => selected && setDraft({ id: selected.id, name })}
      onRename={() => selected && rename.mutate({ id: selected.id, name: nameDraft.trim() }, { onSuccess: () => setDraft(null) })}
      onAddPerson={setAddPerson}
      onAddRole={setAddRole}
      onAdd={() => selected && addPerson && setMember.mutate({ id: selected.id, memberId: addPerson.id, role: addRole }, { onSuccess: () => setAddPerson(null) })}
      onChangeRole={(memberId, role) => selected && setMember.mutate({ id: selected.id, memberId, role })}
      onRemovePerson={(memberId) => selected && removeMember.mutate({ id: selected.id, memberId })}
      onMoveProject={(projectId, toTeamId) => move.mutate({ id: toTeamId, projectId })}
      onAskDelete={() => setConfirmDelete(true)}
      onCancelDelete={() => setConfirmDelete(false)}
      onDelete={() => selected && del.mutate(selected.id, { onSettled: () => { setConfirmDelete(false); setPickedId(undefined) } })}
    />
  )
}
