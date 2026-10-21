// The editing token lives in this browser tab's session storage only: it is never written to disk,
// never sent anywhere except the API, and disappears when the tab closes. Locking clears it.
const KEY = 'signalflow.editToken'
const listeners = new Set<() => void>()

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(KEY, token)
    else sessionStorage.removeItem(KEY)
  } catch {
    /* storage unavailable: the token simply is not remembered */
  }
  listeners.forEach((l) => l())
}

export function subscribeToken(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
