import { InlineNotification, Loading, TextInput } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import { ParticipantFields } from '../../components/ParticipantFields'
import { PlanFields } from '../../components/PlanFields'
import type { FieldErrors, WizardForm } from '../wizard/form'
import { ProjectHeader } from './ProjectHeader'
import { SaveBar, type SaveBarProps } from './SaveBar'
import styles from './TestPlanView.module.scss'

export type TestPlanViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  form: WizardForm
  errors: FieldErrors
  methodOptions: string[]
  errorText?: string
  save: SaveBarProps
  onChange: (next: WizardForm) => void
  onBack: () => void
}

// Presentational: the Test Plan screen. Loading, error and ready are declared here.
export function TestPlanView({ state, project, form, errors, methodOptions, errorText, save, onChange, onBack }: TestPlanViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the test plan" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Test Plan" subtitle={errorText} />
  const readOnly = !save.canEdit
  return (
    <div className={styles.page}>
      <ProjectHeader name={project.name} status={project.status} title="Test Plan" description="What you are testing, what you expect to learn, and who you will speak with." onBack={onBack} />
      <SaveBar {...save} />
      <TextInput id="project-name" labelText="Project name" readOnly={readOnly} value={form.name} invalid={!!errors.name} invalidText={errors.name} onChange={(e) => onChange({ ...form, name: e.target.value })} />
      <PlanFields form={form} methodOptions={methodOptions} readOnly={readOnly} onChange={onChange} />
      <h2 className={styles.section}>Participants</h2>
      <ParticipantFields form={form} errors={errors} readOnly={readOnly} onChange={onChange} />
    </div>
  )
}
