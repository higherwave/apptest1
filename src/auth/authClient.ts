// The browser side of sign-in: the Better Auth client, pointed at the API's /auth routes on this same origin, so the
// session cookie is a plain first-party cookie.
import { createAuthClient } from 'better-auth/react'
import type { SignInOption } from '../api/client'

export const authClient = createAuthClient({ baseURL: `${window.location.origin}/api/v1/auth` })

// Starts sign-in with Google or the company's identity provider; the provider sends the person back to where they were.
// (The company provider is registered with the server as the social provider "oidc".)
export async function signInWith(id: SignInOption['id'], callbackURL = window.location.pathname + window.location.search) {
  const result = await authClient.signIn.social({ provider: id, callbackURL })
  // A provider the server could not reach at start-up (a wrong issuer address) is reported as not found.
  if (result?.error?.code === 'PROVIDER_NOT_FOUND') result.error.message = 'The sign-in provider could not be reached. Ask whoever runs this workspace to check its sign-in settings.'
  return result
}

// Ends the session, then loads the app fresh so nothing from the last person stays in memory.
export async function signOut() {
  await authClient.signOut().catch(() => undefined)
  window.location.assign('/')
}
