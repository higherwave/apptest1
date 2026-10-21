import { Add, TrashCan } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, TextInput } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import type { TaskForm } from '../wizard/form'
import { ProjectHeader } from './ProjectHeader'
import { SaveBar, type SaveBarProps } from './SaveBar'
import styles from './TaskListView.module.scss'

export type TaskListViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  tasks: TaskForm
  errorText?: string
  save: SaveBarProps
  onChange: (next: TaskForm) => void
  onBack: () => void
}

// Presentational: the questions and follow-ups participants will be asked, in order.
export function TaskListView({ state, project, tasks, errorText, save, onChange, onBack }: TaskListViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the task list" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Task List" subtitle={errorText} />
  const readOnly = !save.canEdit
  const setTask = (i: number, patch: Partial<TaskForm[number]>) => onChange(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <div className={styles.page}>
      <ProjectHeader name={project.name} status={project.status} title="Task List" description="The questions and tasks you will take participants through, with follow-ups." onBack={onBack} />
      <SaveBar {...save} />

      {tasks.length === 0 && <p className={styles.empty}>No tasks yet. Add the first question.</p>}

      {tasks.map((task, i) => (
        <fieldset key={i} className={styles.task}>
          <legend className={styles.legend}>Task {i + 1}</legend>
          <div className={styles.row}>
            <TextInput id={`task-${i}`} labelText={`Question ${i + 1}`} hideLabel readOnly={readOnly} value={task.prompt} onChange={(e) => setTask(i, { prompt: e.target.value })} />
            {!readOnly && <Button kind="ghost" size="md" hasIconOnly renderIcon={TrashCan} iconDescription={`Remove task ${i + 1}`} onClick={() => onChange(tasks.filter((_, j) => j !== i))} />}
          </div>
          {task.followUps.map((followUp, j) => (
            <div key={j} className={styles.followUp}>
              <TextInput
                id={`task-${i}-followup-${j}`}
                labelText={`Follow-up ${j + 1} for task ${i + 1}`}
                hideLabel
                readOnly={readOnly}
                value={followUp}
                onChange={(e) => setTask(i, { followUps: task.followUps.map((f, k) => (k === j ? e.target.value : f)) })}
              />
              {!readOnly && (
                <Button kind="ghost" size="md" hasIconOnly renderIcon={TrashCan} iconDescription={`Remove follow-up ${j + 1}`} onClick={() => setTask(i, { followUps: task.followUps.filter((_, k) => k !== j) })} />
              )}
            </div>
          ))}
          {!readOnly && (
            <Button kind="ghost" size="sm" renderIcon={Add} onClick={() => setTask(i, { followUps: [...task.followUps, ''] })}>
              Add follow-up
            </Button>
          )}
        </fieldset>
      ))}

      {!readOnly && (
        <Button kind="secondary" size="md" renderIcon={Add} onClick={() => onChange([...tasks, { prompt: '', followUps: [] }])}>
          Add task
        </Button>
      )}
    </div>
  )
}
