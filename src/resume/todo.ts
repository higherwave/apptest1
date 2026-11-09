import type { Project } from '../api/client'

export type Todo = { project: Project; text: string; path: string; urgent: boolean }

// What is left on one project, read from the figures on its card. Null when there is nothing to chase: it is analyzed and measured.
export function nextTodo(p: Project): Todo | null {
  const at = (step: string) => `/projects/${p.id}/${step}`
  if (p.status === 'draft') {
    return p.sessions > 0
      ? { project: p, text: `Analyze the ${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'} to find themes`, path: at('transcripts'), urgent: true }
      : { project: p, text: 'Finish the test plan and add sessions', path: at('plan'), urgent: false }
  }
  if (p.measurements === 0) {
    return p.highPriority > 0
      ? { project: p, text: `${p.highPriority} high-priority ${p.highPriority === 1 ? 'theme' : 'themes'} to turn into requirements`, path: at('prio'), urgent: true }
      : { project: p, text: 'Review the themes and set priorities', path: at('themes'), urgent: false }
  }
  return null
}
