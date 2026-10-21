import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMe, useProject, useSaveParticipants, useSaveStudy, useTemplates } from '../../api/hooks'
import { formFromProject, participantsChanged, planChanged, toParticipantsRequest, toPlanRequest, validateStep, type FieldErrors, type WizardForm } from '../wizard/form'
import { TestPlanView } from './TestPlanView'
import { useSaveFlow } from './useSaveFlow'

// Container: loads the project, edits a copy of its plan and participants, and saves the parts that
// changed, one after the other, each against the version the previous save returned.
export function TestPlanPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const templates = useTemplates()
  const me = useMe()
  const saveStudy = useSaveStudy(projectId)
  const saveParticipants = useSaveParticipants(projectId)
  const flow = useSaveFlow(projectId, project.data)
  const [form, setForm] = useState<WizardForm | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  useEffect(() => {
    if (project.data && form === null) setForm(formFromProject(project.data))
  }, [project.data, form])

  const saved = project.data
  const dirty = !!saved && !!form && (planChanged(form, saved) || participantsChanged(form, saved))
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
    const found = { ...validateStep(form, 0), ...validateStep(form, 2) }
    setErrors(found)
    if (Object.keys(found).length) return
    const after = await flow.save(async (startVersion) => {
      let latest = saved
      let version = startVersion
      if (planChanged(form, saved)) {
        latest = await saveStudy.mutateAsync({ version, body: toPlanRequest(form) })
        version = latest.version
      }
      if (participantsChanged(form, saved)) latest = await saveParticipants.mutateAsync({ version, body: toParticipantsRequest(form) })
      return latest
    }, overwrite)
    if (after) setForm(formFromProject(after))
  }

  const state = project.isPending || form === null ? (project.isError ? 'error' : 'loading') : project.isError ? 'error' : 'ready'

  return (
    <TestPlanView
      state={state}
      project={saved}
      form={form ?? formFromBlank}
      errors={errors}
      methodOptions={templates.data?.methodOptions ?? []}
      errorText={project.isError ? friendlyMessage(project.error) : undefined}
      save={{
        dirty, canEdit, saving: flow.saving, conflict: flow.conflict, error: flow.error, savedAt: flow.savedAt,
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

const formFromBlank: WizardForm = { name: '', templateKey: 'blank', what: '', jtbd: { when: '', want: '', so: '' }, outcomes: [''], methods: [], participants: [] }
