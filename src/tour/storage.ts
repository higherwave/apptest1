// What this browser remembers about the tours: whether the welcome screen has been shown, and which tours were finished.
// Only a convenience: when the browser will not store it (a private window, blocked site data), the tours still work.
const KEY = 'signal-flow-tour'

export type TourMemory = { welcomed: boolean; finished: string[] }

export function readMemory(): TourMemory {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { welcomed: raw.welcomed === true, finished: Array.isArray(raw.finished) ? raw.finished.filter((x: unknown) => typeof x === 'string') : [] }
  } catch {
    return { welcomed: false, finished: [] }
  }
}

export function writeMemory(memory: TourMemory) {
  try {
    localStorage.setItem(KEY, JSON.stringify(memory))
  } catch {
    // not stored; nothing depends on it
  }
}
