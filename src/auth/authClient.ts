// The browser side of sign-in: the Better Auth client, pointed at the API's /auth routes on this same origin, so the
// session cookie is a plain first-party cookie.
import { createAuthClient } from 'better-auth/react'
import type { SignInOption } from '../api/client'
import { reportProblem } from '../shell/problems'

export const authClient = createAuthClient({ baseURL: `${window.location.origin}/api/v1/auth` })

// Starts sign-in with Google or the company's identity provider; the provider sends the person back to where they were.
// (The company provider is registered with the server as the social provider "oidc".)
// The way back is a full address: with customer addresses the sign-in itself happens on one fixed address, so a bare path would land the person
// there instead of where they started. (On a single address it is the same place either way.)
export async function signInWith(id: SignInOption['id'], callbackURL = window.location.origin + window.location.pathname + window.location.search) {
  const target = callbackURL.startsWith('/') ? window.location.origin + callbackURL : callbackURL
  const result = await authClient.signIn.social({ provider: id, callbackURL: target })
  // A provider the server could not reach at start-up (a wrong issuer address) is reported as not found.
  if (result?.error?.code === 'PROVIDER_NOT_FOUND') result.error.message = 'The sign-in provider could not be reached. Ask whoever runs this workspace to check its sign-in settings.'
  return result
}

// Ends the session, then loads the app fresh so nothing from the last person stays in memory. If the server refuses or cannot be reached the
// person stays where they are, with the reason in the problem bar, instead of being reloaded into the same session without a word.
export async function signOut() {
  try {
    const result = await authClient.signOut()
    if (result?.error) {
      reportProblem('request', `Sign out did not work: ${result.error.message || result.error.statusText || result.error.status}`, JSON.stringify(result.error))
      return
    }
  } catch (e) {
    reportProblem('request', 'Sign out did not work: the server could not be reached', String(e))
    return
  }
  window.location.assign('/')
}
