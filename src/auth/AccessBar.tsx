import { Button, InlineNotification, Modal, OverflowMenu, OverflowMenuItem, Tag, TextInput } from '@carbon/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { friendlyMessage, getMe } from '../api/client'
import { useAiStatus, useMe } from '../api/hooks'
import { setToken } from '../api/token'
import { signInWithGoogle, signOut } from './authClient'
import styles from './AccessBar.module.scss'

// The "Editing unlocked" badge and the Lock button are hidden unless VITE_SHOW_ACCESS_CONTROLS=true, so a shared demo looks
// clean; editing itself works the same either way. A read-only visitor still sees how to unlock.
const PURPOSE_LABEL: Record<string, string> = { analysis: 'Transcript analysis', spec_step: 'Requirements drafting', theme_match: 'Theme matching' }
const showAccess = import.meta.env.VITE_SHOW_ACCESS_CONTROLS === 'true'

// Shows whether this tab can edit, and asks for the access token to unlock editing.
export function AccessBar() {
  const me = useMe()
  const ai = useAiStatus()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [problemOpen, setProblemOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const editing = me.data?.role === 'owner' || me.data?.role === 'editor'
  const signedIn = me.data?.via === 'session'
  // Before sign-in is the only way in, the token controls stay out of sight unless asked for; a read-only visitor of a
  // deployment without sign-in still needs them.
  const tokenControls = !signedIn && (showAccess || !me.data?.signInAvailable)

  const close = () => {
    setOpen(false)
    setValue('')
    setError(null)
  }

  // The token is checked against the API before it is remembered, so a typo never looks like success.
  const unlock = async () => {
    setChecking(true)
    setError(null)
    try {
      const who = await getMe(value.trim())
      if (who.role === 'viewer') throw new Error('That token was not accepted.')
      setToken(value.trim())
      await queryClient.invalidateQueries()
      close()
    } catch (err) {
      setError(err instanceof Error && err.message === 'That token was not accepted.' ? err.message : friendlyMessage(err))
    } finally {
      setChecking(false)
    }
  }

  const lock = async () => {
    setToken(null)
    await queryClient.invalidateQueries()
  }

  if (me.isPending) return null

  return (
    <div className={styles.bar}>
      {!signedIn && (showAccess || !editing) ? (
        <Tag size="sm" type={editing ? 'green' : 'gray'}>
          {editing ? 'Editing unlocked' : 'Read-only demo'}
        </Tag>
      ) : null}
      {ai.data && (
        <Tag size="sm" type={ai.data.mode === 'live' ? 'blue' : 'gray'}>
          {ai.data.mode === 'live' ? 'AI: live' : 'AI: simulated'}
        </Tag>
      )}
      {ai.data?.problems && (
        <Button kind="ghost" size="sm" onClick={() => setProblemOpen(true)}>
          AI problems ({ai.data.problems.length})
        </Button>
      )}
      {tokenControls &&
        (editing ? (
          showAccess && (
            <Button kind="ghost" size="sm" onClick={lock}>
              Lock
            </Button>
          )
        ) : (
          <Button kind="ghost" size="sm" onClick={() => setOpen(true)}>
            Unlock editing
          </Button>
        ))}
      {!signedIn && me.data?.signInAvailable && (
        <Button kind="ghost" size="sm" onClick={() => signInWithGoogle()}>
          Sign in
        </Button>
      )}
      {signedIn && me.data && (
        <>
          <span className={styles.who}>{me.data.displayName}</span>
          <Tag size="sm" type="gray">
            {me.data.role}
          </Tag>
          <OverflowMenu iconDescription="Account" flipped size="sm" aria-label="Account">
            <OverflowMenuItem itemText="Members" onClick={() => navigate('/members')} />
            <OverflowMenuItem itemText="Sign out" onClick={signOut} />
          </OverflowMenu>
        </>
      )}

      <Modal open={problemOpen} passiveModal size="md" modalHeading="Recent AI problems" onRequestClose={() => setProblemOpen(false)}>
        <ul className={styles.problems}>
          {ai.data?.problems?.map((p) => (
            <li key={`${p.at}-${p.code}`} className={styles.problem}>
              <p className={styles.problemHead}>
                {new Date(p.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })} · {PURPOSE_LABEL[p.purpose] ?? p.purpose}
              </p>
              <p className={styles.problemText}>{p.message}</p>
              {p.detail && <p className={styles.problemDetail}>{p.detail}</p>}
              <p className={styles.problemDetail}>{p.code}</p>
            </li>
          ))}
        </ul>
        <p className={styles.help}>The last 10 problems from the past 30 days. Nothing from the research is stored with them.</p>
      </Modal>

      <Modal
        open={open}
        modalHeading="Unlock editing"
        primaryButtonText={checking ? 'Checking…' : 'Unlock'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={!value.trim() || checking}
        onRequestClose={close}
        onRequestSubmit={unlock}
        size="sm"
      >
        <p className={styles.help}>Enter the access token. It is kept in this browser tab only and is cleared when you lock or close the tab.</p>
        <TextInput
          id="access-token"
          type="password"
          labelText="Access token"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && value.trim() && !checking) unlock()
          }}
        />
        {error && <InlineNotification className={styles.error} kind="error" lowContrast hideCloseButton title="Not unlocked" subtitle={error} />}
      </Modal>
    </div>
  )
}
