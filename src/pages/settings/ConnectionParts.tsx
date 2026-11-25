import { useState, type ReactNode } from 'react'
import { Button, InlineNotification, Modal, TextInput } from '@carbon/react'
import { friendlyMessage } from '../../api/client'
import styles from './PulseSources.module.scss'

// The parts every in-app connection shares: a form that asks for the address and the secret (the secret in a password-style field), and a confirmation before disconnecting. The secret is sent once, tried by
// the server first, stored encrypted and never shown again; the form clears it as soon as it is saved.
export type ConnectField = { key: string; label: string; secret?: boolean; placeholder?: string; helper?: string; initial?: string }

export function ConnectForm({ kind, intro, fields, submitLabel, pending, error, onSubmit }: { kind: string; intro: ReactNode; fields: ConnectField[]; submitLabel: string; pending: boolean; error: unknown; onSubmit: (values: Record<string, string>) => Promise<unknown> }) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, f.initial ?? ''])))
  const ready = fields.every((f) => f.helper?.includes('optional') || (values[f.key] ?? '').trim() !== '')
  const save = async () => {
    try {
      await onSubmit(values)
      // Secrets are not kept in the page once saved.
      setValues(Object.fromEntries(fields.map((f) => [f.key, f.secret ? '' : (values[f.key] ?? '')])))
    } catch {
      /* the message is shown below */
    }
  }
  return (
    <div className={styles.form} data-testid={`connect-${kind}-form`}>
      <p className={styles.detail}>{intro}</p>
      {fields.map((f) => (
        <TextInput
          key={f.key}
          id={`conn-${kind}-${f.key}`}
          data-testid={`conn-${kind}-${f.key}`}
          type={f.secret ? 'password' : 'text'}
          autoComplete={f.secret ? 'new-password' : 'off'}
          labelText={f.label}
          placeholder={f.placeholder}
          helperText={f.helper}
          value={values[f.key] ?? ''}
          onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
        />
      ))}
      {error ? <InlineNotification hideCloseButton lowContrast kind="error" title="Not connected" subtitle={friendlyMessage(error)} data-testid={`connect-error-${kind}`} /> : null}
      <div>
        <Button kind="primary" size="md" data-testid={`connect-${kind}`} disabled={!ready || pending} onClick={save}>
          {pending ? 'Trying it…' : submitLabel}
        </Button>
      </div>
    </div>
  )
}

export function DisconnectModal({ kind, name, open, pending, error, extra, onClose, onConfirm }: { kind: string; name: string; open: boolean; pending: boolean; error: unknown; extra?: string; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal open={open} danger modalHeading={`Disconnect ${name}?`} primaryButtonText={pending ? 'Disconnecting…' : 'Disconnect'} secondaryButtonText="Cancel" primaryButtonDisabled={pending} onRequestClose={onClose} onRequestSubmit={onConfirm} data-testid={`disconnect-${kind}-modal`}>
      <p>The stored secret is deleted. {extra ?? 'What was already read stays.'} You can connect again at any time.</p>
      {error ? <InlineNotification hideCloseButton lowContrast kind="error" title="Not disconnected" subtitle={friendlyMessage(error)} /> : null}
    </Modal>
  )
}
