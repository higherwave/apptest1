import { Button, Dropdown, InlineNotification, Loading } from '@carbon/react'
import type { FieldErrors, PlanForm } from './form'
import { TestPlanForm } from './TestPlanForm'
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
  onCancel: () => void
}

// Presentational: the whole new test plan on one page, with Save at the top.
export function NewTestPlanView({ state, form, errors, teams, teamId, onTeam, methodOptions, saving, submitError, loadError, onChange, onSave, onCancel }: NewTestPlanViewProps) {
  return (
    <div className={styles.page}>
      <Button className={styles.cancel} kind="ghost" size="sm" onClick={onCancel}>
        ← Cancel
      </Button>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>New test plan</h1>
          <p className={styles.description}>Set up what you are testing, then add participants.</p>
        </div>
        <Button kind="primary" onClick={onSave} disabled={saving || state !== 'ready'}>
          {saving ? 'Saving…' : 'Save test plan'}
        </Button>
      </header>

      {state === 'loading' && <Loading small withOverlay={false} description="Loading the test methods" />}
      {state === 'error' && <InlineNotification kind="warning" lowContrast hideCloseButton title="Test methods" subtitle={loadError} />}
      {state === 'ready' && teams.length > 0 && (
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
      {state === 'ready' && <TestPlanForm form={form} errors={errors} methodOptions={methodOptions} onChange={onChange} />}
      {submitError && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={submitError} />}
    </div>
  )
}
