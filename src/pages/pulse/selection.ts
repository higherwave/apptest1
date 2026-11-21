import { useCallback, useSyncExternalStore } from 'react'

// The topics a person has picked to start a project from. It follows them between Topics and a topic's details, and survives a reload of the tab (sessionStorage), so a
// half-made choice is not lost. Kept by id; ids of topics that no longer exist are dropped by the pages that show them.
const KEY = 'signalflow.pulse.selection'
let ids: string[] = read()
const listeners = new Set<() => void>()

function read(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
function write(next: string[]) {
  ids = next
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* kept in memory only */
  }
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useTopicSelection() {
  const selected = useSyncExternalStore(subscribe, () => ids)
  const toggle = useCallback((id: string) => write(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]), [])
  const only = useCallback((id: string) => write([id]), [])
  const clear = useCallback(() => write([]), [])
  const keepOnly = useCallback((valid: string[]) => { if (ids.some((x) => !valid.includes(x))) write(ids.filter((x) => valid.includes(x))) }, [])
  return { selected, toggle, only, clear, keepOnly }
}
