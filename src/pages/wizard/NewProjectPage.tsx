import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiRequestError, friendlyMessage } from '../../api/client'
import { useCreateProject, useMe, useTemplates } from '../../api/hooks'
import { STEPS, applyTemplate, emptyForm, stepForField, toRequest, validateStep, type FieldErrors, type WizardForm } from './form'
import { WizardView } from './WizardView'

// Container: holds the form, validates each step, creates the project, and opens its Task List, as the
// prototype does. A server-side 422 puts the error on the field and returns to the step that shows it.
export function NewProjectPage() {
  const navigate = useNavigate()
  const templates = useTemplates()
  const me = useMe()
  const create = useCreateProject()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<WizardForm>(emptyForm)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | undefined>()
  const [seeded, setSeeded] = useState(false)

  const list = templates.data?.data ?? []
  // Start from the first template's defaults once they have loaded.
  if (!seeded && list.length) {
    setSeeded(true)
    setForm((f) => applyTemplate(f, list[0]))
  }

  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'
  const state = templates.isPending ? 'loading' : templates.isError ? 'error' : 'ready'

  const next = async () => {
    const found = validateStep(form, step)
    setErrors(found)
    setSubmitError(undefined)
    if (Object.keys(found).length) return
    if (step < STEPS.length - 1) return setStep(step + 1)
    if (!canEdit) return setSubmitError('Editing is locked. Use "Unlock editing" at the top of the page.')
    try {
      const created = await create.mutateAsync(toRequest(form))
      navigate(`/projects/${created.id}/tasks`)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'validation_failed' && err.field) {
        setErrors({ [err.field]: err.message })
        setStep(stepForField(err.field))
      } else {
        setSubmitError(friendlyMessage(err))
      }
    }
  }

  return (
    <WizardView
      state={state}
      step={step}
      form={form}
      errors={errors}
      templates={list}
      methodOptions={templates.data?.methodOptions ?? []}
      saving={create.isPending}
      submitError={submitError}
      loadError={templates.isError ? friendlyMessage(templates.error) : undefined}
      onChange={setForm}
      onTemplate={(key) => {
        const t = list.find((x) => x.key === key)
        if (t) setForm((f) => applyTemplate(f, t))
      }}
      onBack={() => {
        setErrors({})
        setSubmitError(undefined)
        setStep(Math.max(0, step - 1))
      }}
      onNext={next}
      onCancel={() => navigate('/projects')}
    />
  )
}
