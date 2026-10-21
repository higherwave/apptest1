import { InlineNotification, Loading } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import type { FieldErrors, PlanForm } from '../testplan/form'
import { TestPlanForm } from '../testplan/TestPlanForm'
import { ProjectHeader } from './ProjectHeader'
import { SaveAlerts, type SaveBarProps } from './SaveBar'
import styles from './TestPlanView.module.scss'

export type TestPlanViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  form: PlanForm
  errors: FieldErrors
  methodOptions: string[]
  errorText?: string
  save: SaveBarProps
  onChange: (next: PlanForm) => void
}

// Presentational: the Test Plan screen. Loading, error and ready are declared here.
export function TestPlanView({ state, project, form, errors, methodOptions, errorText, save, onChange }: TestPlanViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the test plan" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Test Plan" subtitle={errorText} />
  return (
    <div className={styles.page}>
      <ProjectHeader title="Test Plan" description="What you are testing, what you expect to learn, and who you will speak with." save={save} />
      <SaveAlerts {...save} />
      <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} readOnly={!save.canEdit} onChange={onChange} />
    </div>
  )
}
