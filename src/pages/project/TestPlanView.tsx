import { InlineNotification, Loading } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import type { FieldErrors, PlanForm } from '../testplan/form'
import { TestPlanForm } from '../testplan/TestPlanForm'
import { PlanTabs } from './PlanTabs'
import { ProjectHeader } from './ProjectHeader'
import { SaveAlerts, type SaveBarProps } from './SaveBar'
import styles from './TestPlanView.module.scss'

export type TestPlanViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  form: PlanForm
  errors: FieldErrors
  /** The Test Plan (What to test tab) or the Participants page; both edit the same plan. */
  section: 'test' | 'participants'
  methodOptions: string[]
  errorText?: string
  save: SaveBarProps
  onChange: (next: PlanForm) => void
}

// Presentational: the Test Plan screen. Loading, error and ready are declared here.
export function TestPlanView({ state, project, form, errors, section, methodOptions, errorText, save, onChange }: TestPlanViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description={section === 'test' ? 'Loading the test plan' : 'Loading the participants'} />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title={section === 'test' ? 'Test Plan' : 'Participants'} subtitle={errorText} />
  return (
    <div className={styles.page}>
      {section === 'test' ? (
        <>
          <ProjectHeader title="Test Plan" description="What you are testing and what you expect to learn." save={save} />
          <PlanTabs projectId={project.id} active="test" />
        </>
      ) : (
        <ProjectHeader title="Participants" description="Who you will speak with and how to reach them." save={save} />
      )}
      <SaveAlerts {...save} />
      <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} readOnly={!save.canEdit} show={section} onChange={onChange} />
    </div>
  )
}
