import { Button, InlineNotification } from '@carbon/react'
import { Folders } from '@carbon/icons-react'
import { useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ApiRequestError } from '../api/client'
import { useMe } from '../api/hooks'
import { PrivacyNote } from '../shell/PrivacyNote'
import { signInWithGoogle, signOut } from './authClient'
import styles from './AuthGate.module.scss'

// Where a sign-in screen is shown instead of the app: when the API says the request has no session (401 unauthenticated),
// or that the signed-in Google account was not invited (403). Anything else, including loading, shows the app.
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe()
  const { pathname } = useLocation()
  const error = me.error instanceof ApiRequestError && pathname !== '/privacy' ? me.error : null // the privacy page is public
  if (error?.code === 'unauthenticated') return <SignInScreen />
  if (error?.code === 'not_invited' || error?.code === 'email_unverified') return <NoAccessScreen message={error.message} />
  return <>{children}</>
}

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <p className={styles.brand}>
          <Folders size={24} aria-hidden />
          <span>Signal Flow</span>
        </p>
        <h1 className={styles.title}>{title}</h1>
        {children}
        <PrivacyNote />
      </div>
    </main>
  )
}

function SignInScreen() {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await signInWithGoogle()
      if (result?.error) throw new Error(result.error.message || 'Google sign-in could not start.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in could not start.')
      setBusy(false)
    }
  }
  return (
    <Screen title="Sign in">
      <p className={styles.text}>Signal Flow is invite-only. Sign in with the Google account you were invited with.</p>
      <Button kind="primary" size="lg" disabled={busy} onClick={go}>
        {busy ? 'Opening Google…' : 'Continue with Google'}
      </Button>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not signed in" subtitle={error} />}
    </Screen>
  )
}

function NoAccessScreen({ message }: { message: string }) {
  return (
    <Screen title="You have not been invited">
      <p className={styles.text}>{message}</p>
      <p className={styles.text}>Ask an owner to invite that address, or sign out and use a different Google account.</p>
      <Button kind="secondary" size="lg" onClick={signOut}>
        Sign out
      </Button>
    </Screen>
  )
}
