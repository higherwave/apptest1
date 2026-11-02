// The browser side of sign-in: the Better Auth client, pointed at the API's /auth routes on this same origin, so the
// session cookie is a plain first-party cookie.
import { createAuthClient } from 'better-auth/react'
import type { SignInOption } from '../api/client'

export const authClient = createAuthClient({ baseURL: `${window.location.origin}/api/v1/auth` })

// Starts sign-in with Google or the company's identity provider; the provider sends the person back to where they were.
// (The company provider is registered with the server as the social provider "oidc".)
export const signInWith = (id: SignInOption['id'], callbackURL = window.location.pathname + window.location.search) => authClient.signIn.social({ provider: id, callbackURL })

// Ends the session, then loads the app fresh so nothing from the last person stays in memory.
export async function signOut() {
  await authClient.signOut().catch(() => undefined)
  window.location.assign('/')
}
