import { Button, InlineNotification, Loading } from '@carbon/react'
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
  /** When the project was started from Pulse topics: a note saying so, with a way back to each topic that still exists. */
  fromPulse?: { signals: number; topics: { id: string | null; title: string }[]; onOpenTopic: (id: string) => void }
}

const DESCRIPTIONS = {
  test: 'What you are testing and what you expect to learn.',
  ask: 'The questions to ask and the tasks to observe as you take participants through the session, with follow-ups.',
}

// Presentational: the Test Plan, one title and one Save over its two tabs.
export function TestPlanTabsView({ state, project, tab, form, tasks, errors, methodOptions, errorText, save, onChangePlan, onChangeTasks, fromPulse }: TestPlanTabsViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the test plan" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Test Plan" subtitle={errorText} />
  return (
    <div className={styles.page}>
      <ProjectHeader title="Test Plan" description={DESCRIPTIONS[tab]} save={save} />
      <PlanTabs projectId={project.id} active={tab} />
      <SaveAlerts {...save} />
      {fromPulse && (
        <div className={styles.fromPulse} data-testid="from-pulse">
          <span>
            From Pulse: {fromPulse.topics.length} {fromPulse.topics.length === 1 ? 'topic' : 'topics'}, {fromPulse.signals} {fromPulse.signals === 1 ? 'signal' : 'signals'}.
          </span>
          {fromPulse.topics.map((t) =>
            t.id ? (
              <Button key={t.title} kind="ghost" size="sm" onClick={() => fromPulse.onOpenTopic(t.id!)}>
                {t.title}
              </Button>
            ) : (
              <span key={t.title}>{t.title}</span>
            ),
          )}
        </div>
      )}
      {tab === 'test' ? (
        <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} readOnly={!save.canEdit} show="test" onChange={onChangePlan} />
      ) : (
        <TaskListBody tasks={tasks} readOnly={!save.canEdit} onChange={onChangeTasks} />
      )}
    </div>
  )
}
