import { Button, InlineNotification } from '@carbon/react'
import { Route, Routes } from 'react-router-dom'
import { useState, type ReactNode } from 'react'
import { ApiRequestError, type SignInOption } from '../api/client'
import { useMe, useSignInOptions } from '../api/hooks'
import { Logo } from '../shell/Logo'
import { SiteFooter } from '../shell/SiteFooter'
import { LaunchByIdPage } from '../pages/launch/LaunchByIdPage'
import { LaunchesPage } from '../pages/launch/LaunchesPage'
import { signInWith, signOut } from './authClient'
import styles from './AuthGate.module.scss'
import brand from '../../brand/brand.json'

// Where a sign-in screen is shown instead of the app: when the API says the request has no session (401 unauthenticated),
// or that the signed-in account was not invited or is in no allowed group (403). Anything else, including loading, shows the app.
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe()
  const error = me.error instanceof ApiRequestError ? me.error : null
  if (error?.code === 'unauthenticated') return <SignInScreen />
  if (error?.code === 'not_invited' || error?.code === 'email_unverified' || error?.code === 'not_in_group' || error?.code === 'account_mismatch') return <NoAccessScreen message={error.message} invited={error.code === 'not_invited'} />
  // An external member (outside counsel, a partner) reaches only the launches they are asked to review. Those screens arrive with the Launch page.
  if (me.data?.external) return <ExternalApp name={me.data.displayName} />
  return <>{children}</>
}

function Screen({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <main className={styles.screen}>
        <div className={styles.card}>
          <p className={styles.brand}>
            <Logo />
            <span>{brand.appName}</span>
          </p>
          <h1 className={styles.title}>{title}</h1>
          {children}
        </div>
      </main>
      <SiteFooter />
    </div>
  )
}

function SignInScreen() {
  const options = useSignInOptions()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async (id: SignInOption['id'], label: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await signInWith(id)
      if (result?.error) throw new Error(result.error.message || `Sign-in with ${label} could not start.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : `Sign-in with ${label} could not start.`)
      setBusy(false)
    }
  }
  const choices = options.data?.data ?? []
  return (
    <Screen title="Sign in">
      <p className={styles.text}>{brand.appName} is invite-only. Sign in with the account you were invited with.</p>
      {choices.map((o, i) => (
        <Button key={o.id} kind={i === 0 ? 'primary' : 'tertiary'} size="lg" disabled={busy} onClick={() => go(o.id, o.label)}>
          {busy ? `Opening ${o.label}…` : `Continue with ${o.label}`}
        </Button>
      ))}
      {options.isSuccess && choices.length === 0 && <InlineNotification kind="error" lowContrast hideCloseButton title="Sign-in is not set up" subtitle="Ask the person who runs this workspace." />}
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not signed in" subtitle={error} />}
    </Screen>
  )
}

function NoAccessScreen({ message, invited }: { message: string; invited: boolean }) {
  return (
    <Screen title={invited ? 'You have not been invited' : 'No access yet'}>
      <p className={styles.text}>{message}</p>
      <p className={styles.text}>Ask an owner to invite that address or add you to the right group, or sign out and use a different account.</p>
      <Button kind="secondary" size="lg" onClick={signOut}>
        Sign out
      </Button>
    </Screen>
  )
}

// An external reviewer's whole app: the launches they are asked to review, and each one opened by its address. Nothing else is open to them.
function ExternalApp({ name }: { name: string }) {
  return (
    <div className={styles.externalPage}>
      <header className={styles.externalBar}>
        <p className={styles.brand}>
          <Logo />
          <span>{brand.appName}</span>
        </p>
        <span className={styles.externalName}>{name} · external reviewer</span>
        <Button kind="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </header>
      <main className={styles.externalMain}>
        <Routes>
          <Route path="/launches/:launchId" element={<LaunchByIdPage />} />
          <Route path="*" element={<LaunchesPage title="Launches to review" description="The launches you are asked to review. Open one to give your answer." />} />
        </Routes>
      </main>
    </div>
  )
}
