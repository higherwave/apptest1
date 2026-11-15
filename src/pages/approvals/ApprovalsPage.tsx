import { useState } from 'react'
import { friendlyMessage, type ApprovalPerson } from '../../api/client'
import { useApprovals, useSaveApprovalStep, useSetApproverAway } from '../../api/hooks'
import { backupsFor } from './approvalsLogic'
import { ApprovalsView } from './ApprovalsView'

// Container: the approvals grid, the step open in the panel, and the owner-only changes.
export function ApprovalsPage() {
  const approvals = useApprovals()
  const save = useSaveApprovalStep()
  const away = useSetApproverAway()
  const [openStep, setOpenStep] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | undefined>()
  const [confirming, setConfirming] = useState<ApprovalPerson | null>(null)
  const o = approvals.data

  const closePanel = () => { setOpenStep(null); save.reset() }
  const awayFor = confirming && o ? { userId: confirming.userId, name: confirming.name, covering: backupsFor(o, confirming.userId).map((b) => b.name) } : null

  return (
    <ApprovalsView
      state={approvals.isPending ? 'loading' : approvals.isError ? 'error' : 'ready'}
      overview={o}
      errorText={approvals.isError ? friendlyMessage(approvals.error) : away.isError ? friendlyMessage(away.error) : undefined}
      notice={notice}
      busy={save.isPending || away.isPending}
      openStep={openStep}
      panelError={save.isError ? friendlyMessage(save.error) : undefined}
      onOpen={(step) => { setNotice(undefined); away.reset(); save.reset(); setOpenStep(step) }}
      onClosePanel={closePanel}
      onSave={(step, input) =>
        save.mutate({ step, input }, { onSuccess: () => { setOpenStep(null); setNotice('Approvers saved.') } })
      }
      awayFor={awayFor}
      onAway={(person, on) => {
        setNotice(undefined)
        away.reset()
        if (on) setConfirming(person)
        else away.mutate({ userId: person.userId, unavailable: false })
      }}
      onConfirmAway={() => { if (confirming) away.mutate({ userId: confirming.userId, unavailable: true }, { onSettled: () => setConfirming(null) }) }}
      onCancelAway={() => setConfirming(null)}
    />
  )
}
