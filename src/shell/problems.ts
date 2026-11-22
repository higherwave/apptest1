// A small list of the problems the browser met, for the red or yellow bar above the app header (ProblemBanner). It is deliberately outside React:
// it must keep working when the app itself fails to draw, which is exactly when an intermittent error is worth seeing.
//
//   script  (red)    an error thrown in the page, or a promise nobody handled
//   request (yellow) a request that could not reach the server, or one the server answered with a 5xx; also a sign-out that did not work
//
// A request the person did wrong (401, 403, 404, 409, 422, 429) is not a problem here: the screen that made it already says so.

export type ProblemKind = 'script' | 'request'
export type Problem = { kind: ProblemKind; message: string; detail: string; at: number; count: number }

const IGNORED = [/ResizeObserver loop/i, /^AbortError/i, /The user aborted a request/i, /Non-Error promise rejection captured/i]
const MAX = 20

let items: Problem[] = []
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** True once the page is being left: a request cut off by navigation is not a problem. */
let leaving = false
export const markLeaving = () => {
  leaving = true
}

export function reportProblem(kind: ProblemKind, message: string, detail = '', now = Date.now()): void {
  const text = (message || 'Unknown error').trim().slice(0, 300)
  if (IGNORED.some((re) => re.test(text))) return
  if (leaving && kind === 'request') return
  const same = items.find((p) => p.kind === kind && p.message === text)
  if (same) {
    items = items.map((p) => (p === same ? { ...p, count: p.count + 1, at: now } : p))
  } else {
    items = [...items, { kind, message: text, detail: detail.slice(0, 2000), at: now, count: 1 }].slice(-MAX)
  }
  emit()
}

export const dismissProblems = () => {
  items = []
  emit()
}
export const getProblems = () => items
export const subscribeProblems = (cb: () => void) => {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

/** Red when anything is a script error, yellow when there are only failed requests. */
export const levelOf = (list: Problem[]): 'script' | 'request' => (list.some((p) => p.kind === 'script') ? 'script' : 'request')

/** Everything on the list as text to paste into a message: when, what, and where it came from. */
export function problemsText(list: Problem[], page: string): string {
  return [`Page: ${page}`, ...list.map((p) => `[${new Date(p.at).toISOString()}] ${p.kind} x${p.count}: ${p.message}${p.detail ? `\n${p.detail}` : ''}`)].join('\n')
}

/** Listens for errors and unhandled rejections in this page. Call once, before the app draws. */
export function watchPage(target: Window = window): void {
  target.addEventListener('pagehide', markLeaving)
  target.addEventListener('beforeunload', markLeaving)
  target.addEventListener('error', (e: ErrorEvent) => {
    if (/^(chrome|moz|safari-web)-extension:/.test(e.filename ?? '')) return
    reportProblem('script', e.error?.message ?? e.message, String(e.error?.stack ?? `${e.filename ?? ''}:${e.lineno ?? ''}`).split('\n').slice(0, 8).join('\n'))
  })
  target.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const r = e.reason
    reportProblem('script', r?.message ?? String(r), String(r?.stack ?? '').split('\n').slice(0, 8).join('\n'))
  })
}
