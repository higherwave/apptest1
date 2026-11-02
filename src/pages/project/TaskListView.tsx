import { Add, TrashCan } from '@carbon/icons-react'
import { Button, InlineNotification, Loading, TextInput } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import type { TaskForm } from '../testplan/form'
import { ProjectHeader } from './ProjectHeader'
import { SaveAlerts, type SaveBarProps } from './SaveBar'
import styles from './TaskListView.module.scss'

export type TaskListViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  tasks: TaskForm
  errorText?: string
  save: SaveBarProps
  onChange: (next: TaskForm) => void
}

// Presentational: the questions and follow-ups participants will be asked, in order.
export function TaskListView({ state, project, tasks, errorText, save, onChange }: TaskListViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the task list" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Task List" subtitle={errorText} />
  const readOnly = !save.canEdit
  const setTask = (i: number, patch: Partial<TaskForm[number]>) => onChange(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <div className={styles.page}>
      <ProjectHeader title="Task List" description="The questions to ask and the tasks to observe as you take participants through the session, with follow-ups." save={save} />
      <SaveAlerts {...save} />

      {tasks.length === 0 && <p className={styles.empty}>No questions or tasks yet. Add the first one.</p>}

      {tasks.map((task, i) => (
        <fieldset key={i} className={styles.task}>
          <legend className={styles.legend}>{i + 1} · Question to Ask / Task to Observe</legend>
          <div className={styles.row}>
            <TextInput id={`task-${i}`} labelText={`Question to ask or task to observe ${i + 1}`} hideLabel readOnly={readOnly} value={task.prompt} onChange={(e) => setTask(i, { prompt: e.target.value })} />
            {!readOnly && <Button kind="ghost" size="md" hasIconOnly renderIcon={TrashCan} iconDescription={`Remove question or task ${i + 1}`} onClick={() => onChange(tasks.filter((_, j) => j !== i))} />}
          </div>
          {task.followUps.map((followUp, j) => (
            <div key={j} className={styles.followUp}>
              <TextInput
                id={`task-${i}-followup-${j}`}
                labelText={`Follow-up ${j + 1} for question or task ${i + 1}`}
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
          Add question / task
        </Button>
      )}
    </div>
  )
}
