import { Button, Dropdown, InlineNotification, Loading, ProgressIndicator, ProgressStep, TextInput } from '@carbon/react'
import type { Template } from '../../api/client'
import { ParticipantFields } from '../../components/ParticipantFields'
import { PlanFields } from '../../components/PlanFields'
import { STEPS, type FieldErrors, type WizardForm } from './form'
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

          {step === 1 && <PlanFields form={form} methodOptions={methodOptions} onChange={onChange} />}

          {step === 2 && <ParticipantFields form={form} errors={errors} onChange={onChange} />}

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
