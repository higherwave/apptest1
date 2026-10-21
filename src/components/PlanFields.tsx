import { Add, TrashCan } from '@carbon/icons-react'
import { Button, Checkbox, TextArea, TextInput } from '@carbon/react'
import type { WizardForm } from '../pages/wizard/form'
import styles from './fields.module.scss'

type PlanFieldsProps = { form: WizardForm; methodOptions: string[]; readOnly?: boolean; onChange: (next: WizardForm) => void }

// The test plan's fields: what, job to be done, outcomes and methods. Shared by the wizard and the Test Plan screen.
export function PlanFields({ form, methodOptions, readOnly = false, onChange }: PlanFieldsProps) {
  return (
    <>
      <TextArea id="what" labelText="What are we testing?" rows={3} readOnly={readOnly} value={form.what} onChange={(e) => onChange({ ...form, what: e.target.value })} />
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Job to be done</legend>
        <TextInput id="jtbd-when" labelText="When" readOnly={readOnly} value={form.jtbd.when} onChange={(e) => onChange({ ...form, jtbd: { ...form.jtbd, when: e.target.value } })} />
        <TextInput id="jtbd-want" labelText="I want to" readOnly={readOnly} value={form.jtbd.want} onChange={(e) => onChange({ ...form, jtbd: { ...form.jtbd, want: e.target.value } })} />
        <TextInput id="jtbd-so" labelText="So I can" readOnly={readOnly} value={form.jtbd.so} onChange={(e) => onChange({ ...form, jtbd: { ...form.jtbd, so: e.target.value } })} />
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Outcomes expected</legend>
        {form.outcomes.map((outcome, i) => (
          <div key={i} className={styles.row}>
            <TextInput
              id={`outcome-${i}`}
              labelText={`Outcome ${i + 1}`}
              hideLabel
              readOnly={readOnly}
              value={outcome}
              onChange={(e) => onChange({ ...form, outcomes: form.outcomes.map((o, j) => (j === i ? e.target.value : o)) })}
            />
            {!readOnly && (
              <Button
                kind="ghost"
                size="md"
                hasIconOnly
                renderIcon={TrashCan}
                iconDescription="Remove outcome"
                disabled={form.outcomes.length === 1}
                onClick={() => onChange({ ...form, outcomes: form.outcomes.filter((_, j) => j !== i) })}
              />
            )}
          </div>
        ))}
        {!readOnly && (
          <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => onChange({ ...form, outcomes: [...form.outcomes, ''] })}>
            Add outcome
          </Button>
        )}
      </fieldset>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Methods</legend>
        {methodOptions.map((method) => (
          <Checkbox
            key={method}
            id={`method-${method}`}
            labelText={method}
            readOnly={readOnly}
            checked={form.methods.includes(method)}
            onChange={(_, { checked }) => onChange({ ...form, methods: checked ? [...form.methods, method] : form.methods.filter((m) => m !== method) })}
          />
        ))}
      </fieldset>
    </>
  )
}
