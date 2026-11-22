import { Button, InlineNotification, Loading } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import type { FieldErrors, PlanForm, TaskForm } from '../testplan/form'
import { TestPlanForm } from '../testplan/TestPlanForm'
import { ProjectHeader } from './ProjectHeader'
import { SaveAlerts, type SaveBarProps } from './SaveBar'
import { TaskListBody } from './TaskListView'
import styles from './TestPlanView.module.scss'

export type TestPlanTabsViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
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

// Presentational: the Test Plan, one title and one Save. The setup fields are on the left and the questions and tasks on the right, so what the test is,
// what kind of test it is and what will be asked are all in one view.
export function TestPlanTabsView({ state, project, form, tasks, errors, methodOptions, errorText, save, onChangePlan, onChangeTasks, fromPulse }: TestPlanTabsViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the test plan" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Test Plan" subtitle={errorText} />
  return (
    <div className={styles.page}>
      <ProjectHeader title="Test Plan" description="What you are testing, what you expect to learn, and the questions to ask and tasks to observe." save={save} />
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
      <div className={styles.split}>
        <div className={styles.setup} data-testid="plan-setup">
          <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} readOnly={!save.canEdit} show="test" onChange={onChangePlan} />
        </div>
        <section className={styles.ask} aria-labelledby="ask-title" data-testid="plan-ask" data-tour="plan-ask">
          <h2 id="ask-title" className={styles.askTitle}>What to ask or observe</h2>
          <p className={styles.askNote}>The questions to ask and the tasks to observe as you take participants through the session, with follow-ups.</p>
          <TaskListBody tasks={tasks} readOnly={!save.canEdit} onChange={onChangeTasks} />
        </section>
      </div>
    </div>
  )
}
