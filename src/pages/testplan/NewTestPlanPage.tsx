import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiRequestError, friendlyMessage } from '../../api/client'
import { useCreateProject, useMe, useTemplates } from '../../api/hooks'
import { EDITING_LOCKED } from '../../auth/messages'
import { emptyForm, toRequest, validate, type FieldErrors, type PlanForm } from './form'
import { NewTestPlanView } from './NewTestPlanView'

// Container: holds the form, validates it, creates the project, and opens its Task List. A server-side 422
// puts the message on the field it names.
export function NewTestPlanPage() {
  const navigate = useNavigate()
  const templates = useTemplates() // only for the list of test methods
  const me = useMe()
  const create = useCreateProject()
  const [form, setForm] = useState<PlanForm>(emptyForm)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | undefined>()

  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'
  const state = templates.isPending ? 'loading' : templates.isError ? 'error' : 'ready'

  const save = async () => {
    const found = validate(form)
    setErrors(found)
    setSubmitError(undefined)
    if (Object.keys(found).length) return
    if (!canEdit) return setSubmitError(EDITING_LOCKED)
    try {
      const created = await create.mutateAsync(toRequest(form))
      navigate(`/projects/${created.id}/tasks`)
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'validation_failed' && err.field) setErrors({ [err.field]: err.message })
      else setSubmitError(friendlyMessage(err))
    }
  }

  return (
    <NewTestPlanView
      state={state}
      form={form}
      errors={errors}
      methodOptions={templates.data?.methodOptions ?? []}
      saving={create.isPending}
      submitError={submitError}
      loadError={templates.isError ? friendlyMessage(templates.error) : undefined}
      onChange={setForm}
      onSave={save}
      onCancel={() => navigate('/projects')}
    />
  )
}
