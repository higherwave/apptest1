import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useMe, useProject, useSaveTasks } from '../../api/hooks'
import { taskFormFromProject, tasksChanged, toTasksRequest, type TaskForm } from '../testplan/form'
import { TaskListView } from './TaskListView'
import { useSaveFlow } from './useSaveFlow'

// Container: edits a copy of the task list and saves it as a whole, against the version the person opened.
export function TaskListPage() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const project = useProject(projectId)
  const me = useMe()
  const saveTasks = useSaveTasks(projectId)
  const flow = useSaveFlow(projectId, project.data)
  const [tasks, setTasks] = useState<TaskForm | null>(null)

  // The form starts from the saved project once it arrives; after that the person's edits are the form.
  if (project.data && tasks === null) setTasks(taskFormFromProject(project.data))

  const saved = project.data
  const dirty = !!saved && !!tasks && tasksChanged(tasks, saved)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const canEdit = me.data?.role === 'owner' || me.data?.role === 'editor'

  const doSave = async (overwrite: boolean) => {
    if (!tasks) return
    const after = await flow.save((version) => saveTasks.mutateAsync({ version, body: toTasksRequest(tasks) }), overwrite)
    if (after) setTasks(taskFormFromProject(after))
  }

  const state = project.isError ? 'error' : project.isPending || tasks === null ? 'loading' : 'ready'

  return (
    <TaskListView
      state={state}
      project={saved}
      tasks={tasks ?? []}
      errorText={project.isError ? friendlyMessage(project.error) : undefined}
      save={{
        dirty, canEdit, saving: flow.saving, conflict: flow.conflict, error: flow.error, savedAt: flow.savedAt,
        onSave: () => doSave(false),
        onOverwrite: () => doSave(true),
        onReload: async () => {
          const fresh = await flow.reload()
          if (fresh) setTasks(taskFormFromProject(fresh))
        },
      }}
      onChange={setTasks}
      onBack={() => navigate('/projects')}
    />
  )
}
