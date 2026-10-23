// The browser side of sign-in: the Better Auth client, pointed at the API's /auth routes on this same origin, so the
// session cookie is a plain first-party cookie.
import { createAuthClient } from 'better-auth/react'

export const authClient = createAuthClient({ baseURL: `${window.location.origin}/api/v1/auth` })

// Google is the only way in. Google sends the person back to where they were.
export const signInWithGoogle = (callbackURL = window.location.pathname + window.location.search) => authClient.signIn.social({ provider: 'google', callbackURL })

// Ends the session, then loads the app fresh so nothing from the last person stays in memory.
export async function signOut() {
  await authClient.signOut().catch(() => undefined)
  window.location.assign('/')
}
