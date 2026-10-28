import type { MouseEvent } from 'react'
import type { Project } from '../../api/client'

export type ProjectStep = 'plan' | 'themes' | 'measure'

// The step each count belongs to: sessions are planned in the Test Plan, themes live on Themes, measurements on Measure.
export const STAT_STEPS = [
  { key: 'sessions', label: 'Sessions', step: 'plan' },
  { key: 'themes', label: 'Themes', step: 'themes' },
  { key: 'measurements', label: 'Measurements', step: 'measure' },
] as const satisfies readonly { key: keyof Project; label: string; step: ProjectStep }[]

export const stepHref = (project: Project, step: ProjectStep) => `/projects/${project.id}/${step}`

// A real link (it can be opened in a new tab); an ordinary click goes through the router instead of reloading.
export function goTo(onGo: (step: ProjectStep) => void, step: ProjectStep) {
  return (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return
    event.preventDefault()
    onGo(step)
  }
}
