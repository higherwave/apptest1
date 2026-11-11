import { InlineNotification, Loading } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import type { FieldErrors, PlanForm } from '../testplan/form'
import { TestPlanForm } from '../testplan/TestPlanForm'
import { ProjectHeader } from './ProjectHeader'
import { SaveAlerts, type SaveBarProps } from './SaveBar'
import styles from './TestPlanView.module.scss'

export type ParticipantsViewProps = {
  state: 'loading' | 'error' | 'ready'
  project?: ProjectDetail
  form: PlanForm
  errors: FieldErrors
  methodOptions: string[]
  errorText?: string
  save: SaveBarProps
  onChange: (next: PlanForm) => void
}

// Presentational: the Participants screen. Loading, error and ready are declared here.
export function ParticipantsView({ state, project, form, errors, methodOptions, errorText, save, onChange }: ParticipantsViewProps) {
  if (state === 'loading') return <Loading small withOverlay={false} description="Loading the participants" />
  if (state === 'error' || !project) return <InlineNotification kind="warning" lowContrast hideCloseButton title="Participants" subtitle={errorText} />
  return (
    <div className={styles.page}>
      <ProjectHeader title="Participants" description="Who you will speak with and how to reach them." save={save} />
      <SaveAlerts {...save} />
      <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} readOnly={!save.canEdit} show="participants" onChange={onChange} />
    </div>
  )
}
