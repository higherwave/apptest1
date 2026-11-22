import { Button, Dropdown, InlineNotification, Loading } from '@carbon/react'
import type { FieldErrors, PlanForm } from './form'
import splitStyles from '../project/TestPlanView.module.scss'
import { TestPlanForm } from './TestPlanForm'
import { ProjectHeader } from '../project/ProjectHeader'
import styles from './NewTestPlanView.module.scss'

export type NewTestPlanViewProps = {
  state: 'loading' | 'error' | 'ready'
  form: PlanForm
  errors: FieldErrors
  /** The teams to choose between, when the person edits in more than one; empty otherwise. */
  teams: { id: string; name: string }[]
  teamId?: string
  onTeam: (id: string) => void
  methodOptions: string[]
  saving: boolean
  /** Shown when the server refused the request for a reason the form could not catch. */
  submitError?: string
  loadError?: string
  onChange: (next: PlanForm) => void
  onSave: () => void
}

// Presentational: the new test plan, laid out like an existing project's Test Plan (setup on the left, the questions and tasks beside it), with Save at the top.
export function NewTestPlanView({ state, form, errors, teams, teamId, onTeam, methodOptions, saving, submitError, loadError, onChange, onSave }: NewTestPlanViewProps) {
  return (
    <div className={styles.page}>
      <ProjectHeader
        title="Test Plan"
        description="What you are testing and what you expect to learn."
        actions={
          <Button kind="primary" onClick={onSave} disabled={saving || state !== 'ready'}>
            {saving ? 'Saving…' : 'Save test plan'}
          </Button>
        }
      />

      {state === 'loading' && <Loading small withOverlay={false} description="Loading the test methods" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Test methods" subtitle={loadError} />}
      {state === 'ready' && (
        <div className={splitStyles.split}>
          <div className={splitStyles.setup} data-testid="plan-setup">
          {teams.length > 0 && (
            <Dropdown
              id="project-team"
              titleText="Team"
              label="Choose a team"
              helperText="Who sees and works on this project."
              size="lg"
              items={teams}
              itemToString={(t) => t?.name ?? ''}
              selectedItem={teams.find((t) => t.id === teamId) ?? null}
              invalid={!!errors.teamId}
              invalidText={errors.teamId}
              onChange={({ selectedItem }) => selectedItem && onTeam(selectedItem.id)}
            />
          )}
            <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} show="test" onChange={onChange} />
          </div>
          <section className={splitStyles.ask} aria-labelledby="ask-title" data-testid="plan-ask">
            <h2 id="ask-title" className={splitStyles.askTitle}>What to ask or observe</h2>
            <p className={splitStyles.askNote}>Save the test plan first. Then add the questions to ask and the tasks to observe here, beside the setup.</p>
          </section>
        </div>
      )}
      {submitError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={submitError} />}
    </div>
  )
}
