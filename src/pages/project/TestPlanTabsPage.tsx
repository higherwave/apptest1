import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMe, useProject, usePulseOrigin, useSaveStudy, useSaveTasks, useTemplates } from '../../api/hooks'
import { formFromProject, planChanged, taskFormFromProject, tasksChanged, toPlanRequest, toTasksRequest, validate, type FieldErrors, type PlanForm, type TaskForm } from '../testplan/form'
import { usePeek } from '../../peek/context'
import { TestPlanTabsView } from './TestPlanTabsView'
import { useSaveFlow } from './useSaveFlow'

const emptyPlan: PlanForm = { name: '', description: '', methods: [], participants: [] }

// Container for the Test Plan: What to test (the plan) and What to ask or observe (the questions and tasks) are one thing to the person, so
// they are one set of edits with one Save. Both parts are held here, so switching tabs loses nothing; saving sends the plan, then the
// questions and tasks against the version the first save returned.
export function TestPlanTabsPage() {
  const { projectId = '' } = useParams()
  // The old second tab's address now opens the same page: the questions are beside the setup.
  const asked = useLocation().pathname.endsWith('/ask')
  const navigate = useNavigate()
  const peek = usePeek()
  const project = useProject(projectId)
  const templates = useTemplates() // only for the list of test methods
  const me = useMe()
  // When the project was started from Pulse topics (asked only for people who can see Pulse): a note under the title.
  const origin = usePulseOrigin(projectId, !!me.data?.features.pulse)
  const saveStudy = useSaveStudy(projectId)
  const saveTasks = useSaveTasks(projectId)
  const flow = useSaveFlow(projectId, project.data)
  const [form, setForm] = useState<PlanForm | null>(null)
  const [tasks, setTasks] = useState<TaskForm | null>(null)
  const [errors, setErrors] = useState<FieldErrors>({})

  // Both start from the saved project once it arrives; after that the person's edits are the form.
  if (project.data && form === null) setForm(formFromProject(project.data))
  if (project.data && tasks === null) setTasks(taskFormFromProject(project.data))

  const saved = project.data
  useEffect(() => {
    if (asked) navigate(`/projects/${projectId}/plan`, { replace: true })
  }, [asked, projectId, navigate])
  const planDirty = !!saved && !!form && planChanged(form, saved)
  const tasksDirty = !!saved && !!tasks && tasksChanged(tasks, saved)
  const dirty = planDirty || tasksDirty
  // Closing or reloading the tab with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'

  const doSave = async (overwrite: boolean) => {
    if (!saved || !form || !tasks) return
    const found = validate(form, 'test')
    setErrors(found)
    if (Object.keys(found).length) {
      return
    }
    const after = await flow.save(async (version) => {
      let latest = planDirty || overwrite ? await saveStudy.mutateAsync({ version, body: toPlanRequest(form, false) }) : undefined
      if (tasksDirty || overwrite) latest = await saveTasks.mutateAsync({ version: latest?.version ?? version, body: toTasksRequest(tasks) })
      return latest ?? saved
    }, overwrite)
    if (after) {
      setForm(formFromProject(after))
      setTasks(taskFormFromProject(after))
    }
  }

  const state = project.isError ? 'error' : project.isPending || form === null || tasks === null ? 'loading' : 'ready'

  return (
    <TestPlanTabsView
      state={state}
      project={saved}
      form={form ?? emptyPlan}
      tasks={tasks ?? []}
      errors={errors}
      methodOptions={templates.data?.methodOptions ?? []}
      fromPulse={origin.data ? { ...origin.data, onOpenTopic: (id) => peek.open({ kind: 'topic', id }) } : undefined}
      errorText={project.isError ? friendlyMessage(project.error) : undefined}
      save={{
        dirty, canEdit, saving: flow.saving, conflict: flow.conflict, error: flow.error, savedAt: flow.savedAt, saveLabel: 'Save test plan',
        onSave: () => doSave(false),
        onOverwrite: () => doSave(true),
        onReload: async () => {
          const fresh = await flow.reload()
          if (fresh) {
            setForm(formFromProject(fresh))
            setTasks(taskFormFromProject(fresh))
            setErrors({})
          }
        },
      }}
      onChangePlan={setForm}
      onChangeTasks={setTasks}
    />
  )
}
