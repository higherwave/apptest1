import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMarkSetup, useMe, useSetup } from '../../api/hooks'
import { GUARD_ITEMS, ORDER, type SetupKey } from './setupText'
import { SetupView } from './SetupView'

// Container: workspace setup for owners. Which category is open and on which step, what an owner has confirmed in the last one, and the calls that mark a category done or skipped.
export function SetupPage() {
  const me = useMe()
  const owner = me.data?.role === 'owner'
  const setup = useSetup(owner)
  const mark = useMarkSetup()
  const [open, setOpen] = useState<SetupKey | null>(null)
  const [step, setStep] = useState(0)
  const [confirmed, setConfirmed] = useState<boolean[]>(GUARD_ITEMS.map(() => false))

  // The Review step reads the workspace as it is now, after whatever was just done in the Set up step.
  const refetch = setup.refetch
  useEffect(() => {
    if (open && step === 2) void refetch()
  }, [open, step, refetch])

  if (!me.data) return null
  if (!owner) return <Navigate to="/projects" replace />

  const go = (key: SetupKey) => {
    const cat = setup.data?.categories.find((c) => c.key === key)
    if (!cat || cat.status === 'locked') return
    mark.reset()
    setOpen(key)
    setStep(cat.status === 'done' || cat.status === 'skipped' ? 3 : 0)
  }
  const finish = (status: 'done' | 'skipped') => open && mark.mutate({ step: open, status }, { onSuccess: () => setStep(3) })
  const next = () => {
    const i = open ? ORDER.indexOf(open) : -1
    const following = ORDER[i + 1]
    if (following) go(following)
    else setOpen(null)
  }

  return (
    <SetupView
      state={setup.isPending ? 'loading' : setup.isError ? 'error' : 'ready'}
      setup={setup.data}
      errorText={setup.isError ? friendlyMessage(setup.error) : undefined}
      open={open}
      step={step}
      busy={mark.isPending}
      error={mark.isError ? friendlyMessage(mark.error) : undefined}
      confirmed={confirmed}
      onConfirm={(i, on) => setConfirmed((c) => c.map((v, k) => (k === i ? on : v)))}
      onOpen={go}
      onClose={() => { setOpen(null); mark.reset() }}
      onStep={setStep}
      onFinish={finish}
      onNext={next}
    />
  )
}
