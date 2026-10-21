import { Button, Checkbox, Dropdown, InlineNotification, Loading, ProgressIndicator, ProgressStep, TextArea, TextInput } from '@carbon/react'
import { Add, TrashCan } from '@carbon/icons-react'
import type { Template } from '../../api/client'
import { STEPS, blankParticipant, type FieldErrors, type WizardForm } from './form'
import styles from './WizardView.module.scss'

export type WizardViewProps = {
  state: 'loading' | 'error' | 'ready'
  step: number
  form: WizardForm
  errors: FieldErrors
  templates: Template[]
  methodOptions: string[]
  saving: boolean
  /** Shown when the server refused the request for a reason the form could not catch. */
  submitError?: string
  loadError?: string
  onChange: (next: WizardForm) => void
  onTemplate: (key: Template['key']) => void
  onBack: () => void
  onNext: () => void
  onCancel: () => void
}

// Presentational: renders one step of the wizard from the form it is given.
export function WizardView(props: WizardViewProps) {
  const { state, step, form, errors, templates, methodOptions, saving, submitError, loadError, onChange, onTemplate, onBack, onNext, onCancel } = props
  const last = step === STEPS.length - 1
  const selected = templates.find((t) => t.key === form.templateKey) ?? null

  const setParticipant = (i: number, patch: Partial<WizardForm['participants'][number]>) =>
    onChange({ ...form, participants: form.participants.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>New project</h1>
      <ProgressIndicator currentIndex={step} spaceEqually className={styles.steps}>
        {STEPS.map((label) => (
          <ProgressStep key={label} label={label} />
        ))}
      </ProgressIndicator>

      {state === 'loading' && <Loading small withOverlay={false} description="Loading templates" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Templates" subtitle={loadError} />}

      {state === 'ready' && (
        <form className={styles.form} onSubmit={(e) => e.preventDefault()}>
          {step === 0 && (
            <>
              <TextInput
                id="project-name"
                labelText="Project name"
                value={form.name}
                invalid={!!errors.name}
                invalidText={errors.name}
                onChange={(e) => onChange({ ...form, name: e.target.value })}
              />
              <Dropdown
                id="template"
                titleText="Starting template"
                label="Choose a template"
                items={templates}
                itemToString={(t) => t?.name ?? ''}
                selectedItem={selected}
                onChange={({ selectedItem }) => selectedItem && onTemplate(selectedItem.key)}
              />
              {selected?.description && <p className={styles.hint}>{selected.description}</p>}
            </>
          )}

          {step === 1 && (
            <>
              <TextArea id="what" labelText="What are we testing?" rows={3} value={form.what} onChange={(e) => onChange({ ...form, what: e.target.value })} />
              <fieldset className={styles.group}>
                <legend className={styles.legend}>Job to be done</legend>
                <TextInput id="jtbd-when" labelText="When" value={form.jtbd.when} onChange={(e) => onChange({ ...form, jtbd: { ...form.jtbd, when: e.target.value } })} />
                <TextInput id="jtbd-want" labelText="I want to" value={form.jtbd.want} onChange={(e) => onChange({ ...form, jtbd: { ...form.jtbd, want: e.target.value } })} />
                <TextInput id="jtbd-so" labelText="So I can" value={form.jtbd.so} onChange={(e) => onChange({ ...form, jtbd: { ...form.jtbd, so: e.target.value } })} />
              </fieldset>
              <fieldset className={styles.group}>
                <legend className={styles.legend}>Outcomes expected</legend>
                {form.outcomes.map((outcome, i) => (
                  <div key={i} className={styles.row}>
                    <TextInput
                      id={`outcome-${i}`}
                      labelText={`Outcome ${i + 1}`}
                      hideLabel
                      value={outcome}
                      onChange={(e) => onChange({ ...form, outcomes: form.outcomes.map((o, j) => (j === i ? e.target.value : o)) })}
                    />
                    <Button
                      kind="ghost"
                      size="md"
                      hasIconOnly
                      renderIcon={TrashCan}
                      iconDescription="Remove outcome"
                      disabled={form.outcomes.length === 1}
                      onClick={() => onChange({ ...form, outcomes: form.outcomes.filter((_, j) => j !== i) })}
                    />
                  </div>
                ))}
                <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => onChange({ ...form, outcomes: [...form.outcomes, ''] })}>
                  Add outcome
                </Button>
              </fieldset>
              <fieldset className={styles.group}>
                <legend className={styles.legend}>Methods</legend>
                {methodOptions.map((method) => (
                  <Checkbox
                    key={method}
                    id={`method-${method}`}
                    labelText={method}
                    checked={form.methods.includes(method)}
                    onChange={(_, { checked }) => onChange({ ...form, methods: checked ? [...form.methods, method] : form.methods.filter((m) => m !== method) })}
                  />
                ))}
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              {form.participants.map((p, i) => (
                <fieldset key={i} className={styles.group}>
                  <legend className={styles.legend}>Participant {i + 1}</legend>
                  <div className={styles.participant}>
                    <TextInput id={`p-name-${i}`} labelText="Name" value={p.name} invalid={!!errors[`participants.${i}.name`]} invalidText={errors[`participants.${i}.name`]} onChange={(e) => setParticipant(i, { name: e.target.value })} />
                    <TextInput id={`p-role-${i}`} labelText="Role" value={p.role} onChange={(e) => setParticipant(i, { role: e.target.value })} />
                    <TextInput id={`p-email-${i}`} labelText="Email" value={p.email} invalid={!!errors[`participants.${i}.email`]} invalidText={errors[`participants.${i}.email`]} onChange={(e) => setParticipant(i, { email: e.target.value })} />
                    <TextInput id={`p-date-${i}`} labelText="Session date" type="date" value={p.sessionDate} onChange={(e) => setParticipant(i, { sessionDate: e.target.value })} />
                  </div>
                  {form.participants.length > 1 && (
                    <Button kind="ghost" size="sm" renderIcon={TrashCan} onClick={() => onChange({ ...form, participants: form.participants.filter((_, j) => j !== i) })}>
                      Remove participant
                    </Button>
                  )}
                </fieldset>
              ))}
              <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => onChange({ ...form, participants: [...form.participants, blankParticipant()] })}>
                Add participant
              </Button>
            </>
          )}

          {submitError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not created" subtitle={submitError} />}

          <div className={styles.actions}>
            <Button kind="ghost" onClick={onCancel}>
              Cancel
            </Button>
            {step > 0 && (
              <Button kind="secondary" onClick={onBack} disabled={saving}>
                Back
              </Button>
            )}
            <Button kind="primary" onClick={onNext} disabled={saving}>
              {last ? (saving ? 'Creating…' : 'Create project') : 'Next'}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
