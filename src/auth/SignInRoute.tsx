import { Button, InlineNotification, Loading } from '@carbon/react'
import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMe } from '../api/hooks'
import { signInWithGoogle } from './authClient'
import styles from './AuthGate.module.scss'

// Opens Google, which brings the person back to the projects. Resolves with a message if Google could not be opened.
async function beginSignIn(): Promise<string | null> {
  try {
    const result = await signInWithGoogle('/insights/themes')
    if (result?.error) throw new Error(result.error.message || 'Google sign-in could not start.')
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Google sign-in could not start.'
  }
}

// /sign-in: where the landing page's Sign in button goes. It opens Google straight away; someone who is already signed in just
// goes to the projects.
export function SignInRoute() {
  const me = useMe()
  const [error, setError] = useState<string | null>(null)
  const signedIn = me.data?.via === 'session'
  useEffect(() => {
    if (me.isPending || signedIn) return
    beginSignIn().then(setError)
  }, [me.isPending, signedIn])
  if (signedIn) return <Navigate to="/insights/themes" replace />
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
                beginSignIn().then(setError)
              }}
            >
              Try again
            </Button>
          </>
        ) : (
          <Loading small withOverlay={false} description="Opening Google" />
        )}
      </div>
    </main>
  )
}
