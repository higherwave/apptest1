import { Button, InlineNotification, Modal, ProgressBar, Tag, TextInput } from '@carbon/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { friendlyMessage, getMe } from '../api/client'
import { useAiStatus, useMe, useSignInOptions } from '../api/hooks'
import { setToken } from '../api/token'
import { AccountPanel } from './AccountPanel'
import { signInWith } from './authClient'
import styles from './AccessBar.module.scss'

// The "Editing unlocked" badge and the Lock button are hidden unless VITE_SHOW_ACCESS_CONTROLS=true, so a shared demo looks
// clean; editing itself works the same either way. A read-only visitor still sees how to unlock.
const PURPOSE_LABEL: Record<string, string> = { analysis: 'Transcript analysis', spec_step: 'Requirements drafting', theme_match: 'Theme matching' }
const SPEND_LABEL = { half: '50% reached', high: '80% reached', reached: 'Budget reached' } as const
const showAccess = import.meta.env.VITE_SHOW_ACCESS_CONTROLS === 'true'

// Shows whether this tab can edit, and asks for the access token to unlock editing.
export function AccessBar() {
  const me = useMe()
  const signInOptions = useSignInOptions()
  const ai = useAiStatus()
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

  // AI status (spend and recent problems) is a link in the account menu, for signed-in owners only.
  const showStatus = signedIn && me.data?.role === 'owner' && !!(ai.data?.problems || ai.data?.budgetUsd !== undefined)
  const statusLabel = `AI status${ai.data?.problems ? ` (${ai.data.problems.length})` : ''}`

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
        <Button kind="ghost" size="sm" onClick={() => signInWith(signInOptions.data?.data[0]?.id ?? 'google')}>
          Sign in
        </Button>
      )}
      {signedIn && me.data && (
        <AccountPanel
          name={me.data.displayName}
          email={me.data.email}
          role={me.data.role}
          avatarUrl={me.data.avatarUrl}
          statusLabel={showStatus ? statusLabel : undefined}
          onStatus={() => setProblemOpen(true)}
        />
      )}

      <Modal open={problemOpen} passiveModal size="md" modalHeading="AI status" onRequestClose={() => setProblemOpen(false)}>
        {ai.data?.budgetUsd !== undefined && (
          <section className={styles.spend} aria-label="AI spend this month">
            <p className={styles.problemHead}>
              Spend this month{ai.data.month ? ` (${ai.data.month})` : ''}{' '}
              {ai.data.spendLevel && ai.data.spendLevel !== 'ok' && (
                <Tag size="sm" type={ai.data.spendLevel === 'half' ? 'warm-gray' : 'red'}>
                  {SPEND_LABEL[ai.data.spendLevel]}
                </Tag>
              )}
            </p>
            <ProgressBar
              label="AI spend against the monthly budget"
              hideLabel
              size="small"
              value={Math.min(ai.data.spentUsd ?? 0, ai.data.budgetUsd)}
              max={Math.max(ai.data.budgetUsd, 0.01)}
              helperText={`$${(ai.data.spentUsd ?? 0).toFixed(2)} of $${ai.data.budgetUsd.toFixed(2)} (${Math.round(((ai.data.spentUsd ?? 0) / Math.max(ai.data.budgetUsd, 0.01)) * 100)}%)`}
            />
            <p className={styles.help}>Alerts appear at 50%, 80% and 100% of the budget. At 100% AI steps use the simulation until next month or a higher AI_MONTHLY_BUDGET_USD.</p>
          </section>
        )}
        <p className={styles.problemHead}>Recent problems</p>
        {ai.data?.problems?.length ? (
          <ul className={styles.problems}>
            {ai.data.problems.map((p) => (
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
        ) : (
          <p className={styles.help}>No problems in the past 30 days.</p>
        )}
        <p className={styles.help}>Problems: the last 10 from the past 30 days. Nothing from the research is stored with them.</p>
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
