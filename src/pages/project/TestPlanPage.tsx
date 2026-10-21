import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMe, useProject, useSaveStudy, useTemplates } from '../../api/hooks'
import { formFromProject, planChanged, toPlanRequest, validate, type FieldErrors, type PlanForm } from '../testplan/form'
import { TestPlanView } from './TestPlanView'
import { useSaveFlow } from './useSaveFlow'

// Container: loads the project, edits a copy of its test plan, and saves it in one request.
export function TestPlanPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const templates = useTemplates() // only for the list of test methods
  const me = useMe()
  const saveStudy = useSaveStudy(projectId)
  const flow = useSaveFlow(projectId, project.data)
  const [form, setForm] = useState<PlanForm | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  // The form starts from the saved project once it arrives; after that the person's edits are the form.
  if (project.data && form === null) setForm(formFromProject(project.data))

  const saved = project.data
  const dirty = !!saved && !!form && planChanged(form, saved)
  // Closing or reloading the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'

  const doSave = async (overwrite: boolean) => {
    if (!saved || !form) return
    const found = validate(form)
    setErrors(found)
    if (Object.keys(found).length) return
    const after = await flow.save((version) => saveStudy.mutateAsync({ version, body: toPlanRequest(form) }), overwrite)
    if (after) setForm(formFromProject(after))
  }

  const state = project.isPending || form === null ? (project.isError ? 'error' : 'loading') : project.isError ? 'error' : 'ready'

  return (
    <TestPlanView
      state={state}
      project={saved}
      form={form ?? emptyPlan}
      errors={errors}
      methodOptions={templates.data?.methodOptions ?? []}
      errorText={project.isError ? friendlyMessage(project.error) : undefined}
      save={{
        dirty, canEdit, saving: flow.saving, conflict: flow.conflict, error: flow.error, savedAt: flow.savedAt, saveLabel: 'Save test plan',
        onSave: () => doSave(false),
        onOverwrite: () => doSave(true),
        onReload: async () => {
          const fresh = await flow.reload()
          if (fresh) {
            setForm(formFromProject(fresh))
            setErrors({})
          }
        },
      }}
      onChange={setForm}
      onBack={() => navigate('/projects')}
    />
  )
}

const emptyPlan: PlanForm = { name: '', methods: [], testItems: [], participants: [] }
