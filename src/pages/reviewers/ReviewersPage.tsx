import { useState } from 'react'
import { friendlyMessage, type AddReviewerInput, type Member, type ReviewerRole } from '../../api/client'
import { useAddReviewer, useMembers, useRemoveReviewer, useReviewers } from '../../api/hooks'
import { ReviewersView } from './ReviewersView'

// Container: the reviewers and coverage, the add form's state, and the owner-only changes.
export function ReviewersPage() {
  const reviewers = useReviewers()
  const members = useMembers()
  const add = useAddReviewer()
  const remove = useRemoveReviewer()
  const [person, setPerson] = useState<Member | null>(null)
  const [steps, setSteps] = useState<string[]>([])
  const [scope, setScope] = useState<'all' | 'teams'>('teams')
  const [teamIds, setTeamIds] = useState<string[]>([])
  const [role, setRole] = useState<ReviewerRole>('primary')
  const [confirmAll, setConfirmAll] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()

  const failure = [add, remove].find((m) => m.isError)?.error
  const state = reviewers.isPending || members.isPending ? 'loading' : reviewers.isError || members.isError ? 'error' : 'ready'
  // An external member covers chosen teams only, so the all-teams choice falls back to chosen teams for them.
  const effectiveScope = person?.external ? 'teams' : scope

  const submit = () => {
    if (!person) return
    setNotice(undefined)
    add.mutate(
      { memberId: person.id, steps: steps as AddReviewerInput['steps'], teams: effectiveScope === 'all' ? 'all' : teamIds, role },
      { onSuccess: () => { setNotice(`${person.displayName} is set up as ${role} for ${steps.length === 1 ? 'one step' : `${steps.length} steps`}.`); setSteps([]); setTeamIds([]); setConfirmAll(false) }, onError: () => setConfirmAll(false) },
    )
  }

  return (
    <ReviewersView
      state={state}
      overview={reviewers.data}
      people={members.data?.data ?? []}
      errorText={reviewers.isError ? friendlyMessage(reviewers.error) : members.isError ? friendlyMessage(members.error) : failure ? friendlyMessage(failure) : undefined}
      notice={notice}
      person={person}
      steps={steps}
      scope={effectiveScope}
      teamIds={teamIds}
      role={role}
      busy={add.isPending || remove.isPending}
      confirmAll={confirmAll}
      onPerson={(m) => { setPerson(m); setNotice(undefined) }}
      onToggleStep={(key, on) => setSteps((cur) => (on ? [...new Set([...cur, key])] : cur.filter((k) => k !== key)))}
      onScope={setScope}
      onToggleTeam={(id, on) => setTeamIds((cur) => (on ? [...new Set([...cur, id])] : cur.filter((k) => k !== id)))}
      onRole={setRole}
      onAdd={() => (effectiveScope === 'all' ? setConfirmAll(true) : submit())}
      onConfirmAll={submit}
      onCancelAll={() => setConfirmAll(false)}
      onRemove={(id) => { setNotice(undefined); remove.mutate(id) }}
    />
  )
}
