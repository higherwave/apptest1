import { Button, InlineNotification, Loading } from '@carbon/react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMe, useSignInOptions } from '../api/hooks'
import type { SignInOption } from '../api/client'
import { signInWith } from './authClient'
import styles from './AuthGate.module.scss'

// Opens the provider, which brings the person back to the projects. Resolves with a message if it could not be opened.
async function beginSignIn(option: SignInOption): Promise<string | null> {
  try {
    const result = await signInWith(option.id, '/insights/themes')
    if (result?.error) throw new Error(result.error.message || `Sign-in with ${option.label} could not start.`)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : `Sign-in with ${option.label} could not start.`
  }
}

// /sign-in: where the landing page's Sign in button goes. With one way in it opens that provider straight away; with several, the
// choice is on the sign-in screen the app shows. Someone who is already signed in just goes to the projects.
export function SignInRoute() {
  const me = useMe()
  const options = useSignInOptions()
  const [error, setError] = useState<string | null>(null)
  const signedIn = me.data?.via === 'session'
  const choices = options.data?.data ?? []
  const only = choices.length === 1 ? choices[0] : undefined
  useEffect(() => {
    if (me.isPending || signedIn || !only) return
    beginSignIn(only).then(setError)
  }, [me.isPending, signedIn, only])
  if (signedIn || (options.isSuccess && choices.length > 1)) return <Navigate to="/insights/themes" replace />
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        {error ? (
          <>
            <InlineNotification kind="error" lowContrast hideCloseButton title="Not signed in" subtitle={error} />
            <Button
              kind="primary"
              size="lg"
              onClick={() => {
                setError(null)
                if (only) beginSignIn(only).then(setError)
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <Loading small withOverlay={false} description="Opening sign-in" />
        )}
      </div>
    </main>
  )
}
