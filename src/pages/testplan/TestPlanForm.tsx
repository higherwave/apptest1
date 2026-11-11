import { Close } from '@carbon/icons-react'
import { Button, Dropdown, TextArea, TextInput } from '@carbon/react'
import { blankParticipant, SESSION_LENGTHS, type FieldErrors, type PlanForm, type PlanParticipant } from './form'
import styles from './TestPlanForm.module.scss'

type TestPlanFormProps = {
  form: PlanForm
  errors: FieldErrors
  methodOptions: string[]
  readOnly?: boolean
  /** The whole form (a new project), or one of the two project pages: the plan (name, description, methods) or the participants. */
  show?: 'all' | 'test' | 'participants'
  onChange: (next: PlanForm) => void
}

// The test plan form: name, a short project description, methods and participants. The specific questions and tasks are on the Test Plan's
// What to ask or observe tab. New test plan shows all of it; a project's Test Plan tab and its Participants page each show their part.
// Both parts save through the same request, so whatever one page does not show it sends back unchanged.
export function TestPlanForm({ form, errors, methodOptions, readOnly = false, show = 'all', onChange }: TestPlanFormProps) {
  const plan = show !== 'participants'
  const participants = show !== 'test'
  const setParticipant = (i: number, patch: Partial<PlanParticipant>) => onChange({ ...form, participants: form.participants.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  return (
    <div className={styles.form}>
      {plan && (
        <>
      <TextInput
        id="project-name"
        labelText="Project name"
        placeholder="e.g. Clinic booking, usability round 1"
        readOnly={readOnly}
        value={form.name}
        invalid={!!errors.name}
        invalidText={errors.name}
        onChange={(e) => onChange({ ...form, name: e.target.value })}
      />

      <TextArea
        id="project-description"
        labelText="Project description"
        helperText="A sentence or two on what this research is for. The specific questions and tasks go on the What to ask or observe tab."
        placeholder="e.g. Whether first-time patients can find a provider and book without calling the clinic"
        rows={3}
        maxCount={2000}
        readOnly={readOnly}
        value={form.description}
        invalid={!!errors.description}
        invalidText={errors.description}
        onChange={(e) => onChange({ ...form, description: e.target.value })}
      />

      <section className={styles.section} aria-labelledby="methods-label">
        <h2 id="methods-label" className={styles.label}>Test methods</h2>
        <div className={styles.chips}>
          {methodOptions.map((method) => {
            const on = form.methods.includes(method)
            return (
              <Button
                key={method}
                kind={on ? 'primary' : 'tertiary'}
                size="lg"
                className={styles.chip}
                aria-pressed={on}
                disabled={readOnly}
                onClick={() => onChange({ ...form, methods: on ? form.methods.filter((m) => m !== method) : [...form.methods, method] })}
              >
                {method}
              </Button>
            )
          })}
        </div>
      </section>

        </>
      )}

      {participants && (
      <section className={styles.section} aria-labelledby="participants-label">
        {show === 'all' ? <h2 id="participants-label" className={styles.label}>Participants</h2> : <h2 id="participants-label" className={styles.srOnly}>Participants</h2>}
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="Participants">
            <div className={styles.row} role="row">
              {['Name', 'Role or segment', 'Email', 'Phone', 'Session length'].map((h) => (
                <div key={h} className={styles.head} role="columnheader">{h}</div>
              ))}
              <div className={styles.head} role="columnheader"><span className={styles.srOnly}>Remove</span></div>
            </div>
            {form.participants.map((p, i) => (
              <div key={p.id ?? `new-${i}`} className={styles.row} role="row">
                <div role="cell">
                  <TextInput id={`p-name-${i}`} labelText={`Name of participant ${i + 1}`} hideLabel placeholder="Full name" readOnly={readOnly} value={p.name} invalid={!!errors[`participants.${i}.name`]} invalidText={errors[`participants.${i}.name`]} onChange={(e) => setParticipant(i, { name: e.target.value })} />
                </div>
                <div role="cell">
                  <TextInput id={`p-role-${i}`} labelText={`Role or segment of participant ${i + 1}`} hideLabel placeholder="Role or segment" readOnly={readOnly} value={p.role} onChange={(e) => setParticipant(i, { role: e.target.value })} />
                </div>
                <div role="cell">
                  <TextInput id={`p-email-${i}`} labelText={`Email of participant ${i + 1}`} hideLabel placeholder="name@example.com" readOnly={readOnly} value={p.email} invalid={!!errors[`participants.${i}.email`]} invalidText={errors[`participants.${i}.email`]} onChange={(e) => setParticipant(i, { email: e.target.value })} />
                </div>
                <div role="cell">
                  <TextInput id={`p-phone-${i}`} labelText={`Phone of participant ${i + 1}`} hideLabel type="tel" placeholder="(555) 000-0000" readOnly={readOnly} value={p.phone} onChange={(e) => setParticipant(i, { phone: e.target.value })} />
                </div>
                <div role="cell">
                  <Dropdown
                    id={`p-length-${i}`}
                    titleText={`Session length of participant ${i + 1}`}
                    hideLabel
                    label="Choose"
                    size="md"
                    autoAlign
                    items={[...SESSION_LENGTHS]}
                    itemToString={(item) => item?.label ?? ''}
                    selectedItem={SESSION_LENGTHS.find((l) => l.value === p.sessionMinutes) ?? null}
                    readOnly={readOnly}
                    onChange={({ selectedItem }) => setParticipant(i, { sessionMinutes: selectedItem?.value ?? '' })}
                  />
                </div>
                <div role="cell" className={styles.remove}>
                  {!readOnly && (
                    <Button
                      kind="ghost"
                      size="lg"
                      hasIconOnly
                      renderIcon={Close}
                      iconDescription="Remove participant"
                      disabled={form.participants.length === 1}
                      onClick={() => onChange({ ...form, participants: form.participants.filter((_, j) => j !== i) })}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
        {!readOnly && (
          <Button className={styles.add} kind="ghost" size="sm" onClick={() => onChange({ ...form, participants: [...form.participants, blankParticipant()] })}>
            + Add participant
          </Button>
        )}
      </section>
      )}
    </div>
  )
}
