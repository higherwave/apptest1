import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { getProjectStage, listProjects } from '../api/client'
import { useMe } from '../api/hooks'
import { TourOverlay } from './TourOverlay'
import { readMemory, writeMemory, type TourMemory } from './storage'
import { tourById, type Tour, type TourStep } from './tours'
import { WelcomeDialog } from './WelcomeDialog'

import { TourContext, type TourApi } from './tourContext'

// The sample project the project tour follows: one that has come all the way to stories, so every step has something to show.
async function pickProject(): Promise<string | null> {
  const projects = await listProjects()
  const analyzed = projects.filter((p) => p.status === 'analyzed')
  for (const p of analyzed) {
    try {
      if ((await getProjectStage(p.id)).tabs.stories?.enabled) return p.id
    } catch {
      // try the next one
    }
  }
  return (analyzed[0] ?? projects[0])?.id ?? null
}

type Running = { tour: Tour; steps: TourStep[]; index: number }

// Holds the welcome screen and the running tour. The welcome screen opens by itself the first time a read-only visitor arrives, and any
// time from "Take a tour" in the header. What the browser remembers is a convenience only (see storage.ts).
export function TourProvider({ children }: { children: ReactNode }) {
  const me = useMe()
  const { pathname } = useLocation()
  const [memory, setMemory] = useState<TourMemory>(readMemory)
  const [asked, setAsked] = useState(false) // someone chose "Take a tour"
  const [running, setRunning] = useState<Running | null>(null)
  const [starting, setStarting] = useState(false)

  const remember = useCallback((change: Partial<TourMemory>) => {
    setMemory((m) => {
      const next = { ...m, ...change }
      writeMemory(next)
      return next
    })
  }, [])

  // The first visit of a read-only visitor (anonymous or signed in as a viewer) opens the welcome screen. People who can edit ask for it.
  const firstVisit = me.data?.role === 'viewer' && !memory.welcomed && !pathname.startsWith('/sign-in')
  const welcome = (asked || firstVisit) && !running

  const closeWelcome = useCallback(() => {
    setAsked(false)
    remember({ welcomed: true })
  }, [remember])

  const start = useCallback(
    async (id: string) => {
      const tour = tourById(id)
      if (!tour) return
      setStarting(true)
      try {
        const project = tour.steps.some((s) => s.route.includes(':project')) ? await pickProject() : null
        // Without a sample project the steps about it are left out, and the tour says so by ending early.
        const steps = tour.steps.filter((s) => !s.route.includes(':project') || project).map((s) => ({ ...s, route: project ? s.route.replace(':project', project) : s.route }))
        if (steps.length === 0) return
        setAsked(false)
        remember({ welcomed: true })
        setRunning({ tour, steps, index: 0 })
      } finally {
        setStarting(false)
      }
    },
    [remember],
  )

  const end = useCallback(() => {
    setRunning((r) => {
      if (r && r.index === r.steps.length - 1) remember({ finished: [...new Set([...memory.finished, r.tour.id])] })
      return null
    })
  }, [memory.finished, remember])

  const api = useMemo<TourApi>(() => ({ openWelcome: () => setAsked(true), running: running !== null }), [running])

  return (
    <TourContext.Provider value={api}>
      {children}
      <WelcomeDialog open={welcome} finished={memory.finished} starting={starting} onStart={start} onClose={closeWelcome} />
      {running && (
        <TourOverlay
          key={`${running.tour.id}:${running.index}`}
          tour={running.tour}
          steps={running.steps}
          index={running.index}
          onBack={() => setRunning((r) => (r && r.index > 0 ? { ...r, index: r.index - 1 } : r))}
          onNext={() => setRunning((r) => (r && r.index < r.steps.length - 1 ? { ...r, index: r.index + 1 } : r))}
          onEnd={end}
        />
      )}
    </TourContext.Provider>
  )
}
