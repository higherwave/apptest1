import { Button, InlineNotification, Modal, Tag, TextInput } from '@carbon/react'
import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { friendlyMessage, getMe } from '../api/client'
import { useAiStatus, useMe } from '../api/hooks'
import { setToken } from '../api/token'
import styles from './AccessBar.module.scss'

// Shows whether this tab can edit, and asks for the access token to unlock editing.
export function AccessBar() {
  const me = useMe()
  const ai = useAiStatus()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const editing = me.data?.role === 'owner' || me.data?.role === 'editor'

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
      <Tag size="sm" type={editing ? 'green' : 'gray'}>
        {editing ? 'Editing unlocked' : 'Read-only demo'}
      </Tag>
      {ai.data && (
        <Tag size="sm" type={ai.data.mode === 'live' ? 'blue' : 'gray'}>
          {ai.data.mode === 'live' ? 'AI: live' : 'AI: simulated'}
        </Tag>
      )}
      {editing ? (
        <Button kind="ghost" size="sm" onClick={lock}>
          Lock
        </Button>
      ) : (
        <Button kind="ghost" size="sm" onClick={() => setOpen(true)}>
          Unlock editing
        </Button>
      )}

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
