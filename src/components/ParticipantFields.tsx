import { Add, TrashCan } from '@carbon/icons-react'
import { Button, TextInput } from '@carbon/react'
import { blankParticipant, type FieldErrors, type WizardForm } from '../pages/wizard/form'
import styles from './fields.module.scss'

type ParticipantFieldsProps = { form: WizardForm; errors: FieldErrors; readOnly?: boolean; onChange: (next: WizardForm) => void }

// Participants: name, role, email and session date for each. Shared by the wizard and the Test Plan screen.
export function ParticipantFields({ form, errors, readOnly = false, onChange }: ParticipantFieldsProps) {
  const set = (i: number, patch: Partial<WizardForm['participants'][number]>) =>
    onChange({ ...form, participants: form.participants.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  return (
    <>
      {form.participants.map((p, i) => (
        <fieldset key={p.id ?? `new-${i}`} className={styles.group}>
          <legend className={styles.legend}>Participant {i + 1}</legend>
          <div className={styles.participant}>
            <TextInput id={`p-name-${i}`} labelText="Name" readOnly={readOnly} value={p.name} invalid={!!errors[`participants.${i}.name`]} invalidText={errors[`participants.${i}.name`]} onChange={(e) => set(i, { name: e.target.value })} />
            <TextInput id={`p-role-${i}`} labelText="Role" readOnly={readOnly} value={p.role} onChange={(e) => set(i, { role: e.target.value })} />
            <TextInput id={`p-email-${i}`} labelText="Email" readOnly={readOnly} value={p.email} invalid={!!errors[`participants.${i}.email`]} invalidText={errors[`participants.${i}.email`]} onChange={(e) => set(i, { email: e.target.value })} />
            <TextInput id={`p-date-${i}`} labelText="Session date" type="date" readOnly={readOnly} value={p.sessionDate} onChange={(e) => set(i, { sessionDate: e.target.value })} />
          </div>
          {!readOnly && form.participants.length > 1 && (
            <Button kind="ghost" size="sm" renderIcon={TrashCan} onClick={() => onChange({ ...form, participants: form.participants.filter((_, j) => j !== i) })}>
              Remove participant
            </Button>
          )}
        </fieldset>
      ))}
      {!readOnly && (
        <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => onChange({ ...form, participants: [...form.participants, blankParticipant()] })}>
          Add participant
        </Button>
      )}
    </>
  )
}
