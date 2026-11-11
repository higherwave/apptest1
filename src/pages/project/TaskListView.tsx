import { Add, TrashCan } from '@carbon/icons-react'
import { Button, TextInput } from '@carbon/react'
import type { TaskForm } from '../testplan/form'
import { AreaPicker } from '../areas/AreaPicker'
import styles from './TaskListView.module.scss'

// Presentational: the questions and follow-ups participants will be asked, in order. The Test Plan page around it owns the title, tabs and Save.
export function TaskListBody({ tasks, readOnly, onChange }: { tasks: TaskForm; readOnly: boolean; onChange: (next: TaskForm) => void }) {
  const setTask = (i: number, patch: Partial<TaskForm[number]>) => onChange(tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)))

  return (
    <div className={styles.page}>

      {tasks.length > 0 && (
        <p className={styles.areaNote} data-testid="area-note">
          {tasks.filter((t) => t.areaId).length} of {tasks.length} {tasks.length === 1 ? 'has' : 'have'} an experience category. The analysis files what people say under these areas, so a question with none is filed by what was said alone.
        </p>
      )}
      {tasks.length === 0 && <p className={styles.empty}>No questions or tasks yet. Add the first one.</p>}

      {tasks.map((task, i) => (
        <fieldset key={i} className={styles.task}>
          <legend className={styles.legend}>{i + 1} · Question to Ask / Task to Observe</legend>
          <div className={styles.row}>
            <TextInput id={`task-${i}`} labelText={`Question to ask or task to observe ${i + 1}`} hideLabel readOnly={readOnly} value={task.prompt} onChange={(e) => setTask(i, { prompt: e.target.value })} />
            {!readOnly && <Button kind="ghost" size="md" hasIconOnly renderIcon={TrashCan} iconDescription={`Remove question or task ${i + 1}`} onClick={() => onChange(tasks.filter((_, j) => j !== i))} />}
          </div>
          <div className={readOnly ? undefined : styles.underInput}>
            <AreaPicker id={`task-${i}-area`} label="Experience category" value={task.areaId} about={task.prompt} readOnly={readOnly} onChange={(areaId) => setTask(i, { areaId })} />
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
        <Button kind="secondary" size="md" renderIcon={Add} onClick={() => onChange([...tasks, { prompt: '', areaId: null, followUps: [] }])}>
          Add question / task
        </Button>
      )}
    </div>
  )
}
