import { useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { PeekContext } from './context'
import { CasePeek } from './CasePeek'
import { ProjectPeek } from './ProjectPeek'
import type { PeekTarget } from './targets'
import { ThemePeek } from './ThemePeek'
import { TopicPeek } from './TopicPeek'

// One quick-reference drawer for the whole app. A link to something that is not in the current view opens it here instead of taking the person away from what they were doing:
// a scaled-down version of the target, one level only (no history, nothing stacked), with a link at the bottom to the full page. Opening another target replaces what is shown.
export function PeekProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const here = location.pathname + location.search
  // The drawer belongs to the page it was opened on: following the link at the bottom, the Back button or any other navigation closes it.
  const [open, setOpen] = useState<{ target: PeekTarget; at: string } | null>(null)
  const target = open && open.at === here ? open.target : null
  const value = useMemo(() => ({ open: (t: PeekTarget) => setOpen({ target: t, at: here }), close: () => setOpen(null) }), [here])
  const close = value.close
  return (
    <PeekContext.Provider value={value}>
      {children}
      <ThemePeek id={target?.kind === 'theme' ? target.id : null} onClose={close} />
      <ProjectPeek id={target?.kind === 'project' ? target.id : null} onClose={close} />
      <TopicPeek id={target?.kind === 'topic' ? target.id : null} onClose={close} />
      <CasePeek id={target?.kind === 'case' ? target.id : null} onClose={close} />
    </PeekContext.Provider>
  )
}
