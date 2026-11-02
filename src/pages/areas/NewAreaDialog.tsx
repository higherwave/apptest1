import { Button, InlineNotification, Modal, TextInput } from '@carbon/react'
import { useState } from 'react'
import { ApiRequestError, friendlyMessage, type Area } from '../../api/client'
import { useAreas, useCreateArea } from '../../api/hooks'
import styles from './NewAreaDialog.module.scss'

type Found = { id: string; name: string; reason?: string }

// Adding a feature area. The server checks the name against the list: the same name, or an alias of one, is refused (use that one);
// a look-alike is shown, and the person may still add it. Catching a duplicate here, while someone has the context, is the whole point.
export function NewAreaDialog({ id = 'new-area', open, onClose, onDone }: { id?: string; open: boolean; onClose: () => void; onDone: (area: Area) => void }) {
  const areas = useAreas()
  const create = useCreateArea()
  const [name, setName] = useState('')
  const [definition, setDefinition] = useState('')
  const [aliases, setAliases] = useState('')
  const [existing, setExisting] = useState<Found | null>(null)
  const [similar, setSimilar] = useState<Found[]>([])
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setName('')
    setDefinition('')
    setAliases('')
    setExisting(null)
    setSimilar([])
    setError(null)
  }
  const close = () => {
    reset()
    onClose()
  }
  const chooseExisting = (id: string) => {
    const area = areas.data?.data.find((a) => a.id === id)
    reset()
    if (area) onDone(area)
  }
  const submit = async (force: boolean) => {
    setExisting(null)
    setSimilar([])
    setError(null)
    try {
      const area = await create.mutateAsync({ name, definition: definition.trim() || null, aliases: aliases.split(',').map((a) => a.trim()).filter(Boolean), force })
      reset()
      onDone(area)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'duplicate_area') setExisting(err.extra.existing)
      else if (err instanceof ApiRequestError && err.code === 'similar_area') setSimilar(err.extra.similar)
      else setError(friendlyMessage(err))
    }
  }

  return (
    <Modal
      open={open}
      size="sm"
      modalHeading="New feature area"
      primaryButtonText={create.isPending ? 'Adding…' : 'Add area'}
      secondaryButtonText="Cancel"
      primaryButtonDisabled={name.trim().length < 2 || create.isPending || !!existing}
      onRequestClose={close}
      onRequestSubmit={() => void submit(false)}
    >
      <div className={styles.form}>
        <p className={styles.help}>An area is a feature or flow people talk about, like Scheduling or Reminders. Keep the list short: add a new one only when none of the existing ones fits.</p>
        <TextInput id={`${id}-name`} labelText="Name" placeholder="Scheduling" value={name} onChange={(e) => { setName(e.target.value); setExisting(null); setSimilar([]) }} />
        <TextInput id={`${id}-definition`} labelText="What is in this area (optional)" placeholder="Booking, moving and cancelling an appointment" value={definition} onChange={(e) => setDefinition(e.target.value)} />
        <TextInput id={`${id}-aliases`} labelText="Other names people use (optional)" helperText="Separate with commas" placeholder="Booking, appointments" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        {existing && (
          <div className={styles.found} role="alert" data-testid="area-duplicate">
            <InlineNotification kind="warning" lowContrast hideCloseButton title="Already on the list" subtitle={`“${existing.name}” is the same area. Use it instead of adding another.`} />
            <Button kind="primary" size="sm" onClick={() => chooseExisting(existing.id)}>
              Use “{existing.name}”
            </Button>
          </div>
        )}
        {similar.length > 0 && (
          <div className={styles.found} role="alert" data-testid="area-similar">
            <InlineNotification kind="info" lowContrast hideCloseButton title="This looks like an area you have" subtitle={`${similar.map((s) => `“${s.name}”`).join(' and ')} may already cover it.`} />
            <div className={styles.actions}>
              {similar.map((s) => (
                <Button key={s.id} kind="primary" size="sm" onClick={() => chooseExisting(s.id)}>
                  Use “{s.name}”
                </Button>
              ))}
              <Button kind="tertiary" size="sm" onClick={() => void submit(true)}>
                Add it anyway
              </Button>
            </div>
          </div>
        )}
        {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not added" subtitle={error} />}
      </div>
    </Modal>
  )
}
