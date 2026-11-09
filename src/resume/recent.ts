import { STEPS } from '../shell/nav'

// The projects a person had open, newest first, kept in this browser (no account needed, so a read-only visitor gets it too).
// One entry per project: the page they were last on, so "Continue" lands exactly there.
const KEY = 'signal-flow-recent'
const MAX = 8

export type Recent = { projectId: string; step: string; path: string; at: number }

const stepKeys = new Set(STEPS.map((s) => s.key))

function read(): Recent[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.projectId === 'string' && typeof r.path === 'string' && stepKeys.has(r.step) && typeof r.at === 'number') : []
  } catch {
    return []
  }
}

export const readRecent = (): Recent[] => read().sort((a, b) => b.at - a.at)

/** Notes a visit to a project step; any other address is ignored. */
export function noteVisit(pathname: string, search = '', now = Date.now()) {
  const m = pathname.match(/^\/projects\/([^/]+)\/([^/]+)/)
  if (!m || m[1] === 'new' || !stepKeys.has(m[2])) return
  const entry: Recent = { projectId: m[1], step: m[2], path: pathname + search, at: now }
  try {
    const next = [entry, ...read().filter((r) => r.projectId !== entry.projectId)].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage blocked: the panel simply has no history
  }
}

export function ago(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60000))
  if (min < 2) return 'just now'
  if (min < 60) return `${min} minutes ago`
  const h = Math.round(min / 60)
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
