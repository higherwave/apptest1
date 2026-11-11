import { InlineNotification, Loading } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import type { FieldErrors, PlanForm, TaskForm } from '../testplan/form'
import { TestPlanForm } from '../testplan/TestPlanForm'
import { PlanTabs } from './PlanTabs'
import { ProjectHeader } from './ProjectHeader'
import { SaveAlerts, type SaveBarProps } from './SaveBar'
import { TaskListBody } from './TaskListView'
import styles from './TestPlanView.module.scss'

export type TestPlanTabsViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  tab: 'test' | 'ask'
  form: PlanForm
  tasks: TaskForm
  errors: FieldErrors
  methodOptions: string[]
  errorText?: string
  save: SaveBarProps
  onChangePlan: (next: PlanForm) => void
  onChangeTasks: (next: TaskForm) => void
}

const DESCRIPTIONS = {
  test: 'What you are testing and what you expect to learn.',
  ask: 'The questions to ask and the tasks to observe as you take participants through the session, with follow-ups.',
}

// Presentational: the Test Plan, one title and one Save over its two tabs.
export function TestPlanTabsView({ state, project, tab, form, tasks, errors, methodOptions, errorText, save, onChangePlan, onChangeTasks }: TestPlanTabsViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the test plan" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Test Plan" subtitle={errorText} />
  return (
    <div className={styles.page}>
      <ProjectHeader title="Test Plan" description={DESCRIPTIONS[tab]} save={save} />
      <PlanTabs projectId={project.id} active={tab} />
      <SaveAlerts {...save} />
      {tab === 'test' ? (
        <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} readOnly={!save.canEdit} show="test" onChange={onChangePlan} />
      ) : (
        <TaskListBody tasks={tasks} readOnly={!save.canEdit} onChange={onChangeTasks} />
      )}
    </div>
  )
}
