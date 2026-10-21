import { Close } from '@carbon/icons-react'
import { Button, TextArea, TextInput } from '@carbon/react'
import { blankItem, blankParticipant, type FieldErrors, type PlanForm, type PlanItem, type PlanParticipant } from './form'
import styles from './TestPlanForm.module.scss'

type TestPlanFormProps = { form: PlanForm; errors: FieldErrors; methodOptions: string[]; readOnly?: boolean; onChange: (next: PlanForm) => void }

// The whole test plan on one page: name, methods, test items (each with its own outcomes) and participants.
// Shared by New test plan and a project's Test Plan step.
export function TestPlanForm({ form, errors, methodOptions, readOnly = false, onChange }: TestPlanFormProps) {
  const setItem = (i: number, patch: Partial<PlanItem>) => onChange({ ...form, testItems: form.testItems.map((it, j) => (j === i ? { ...it, ...patch } : it)) })
  const setParticipant = (i: number, patch: Partial<PlanParticipant>) => onChange({ ...form, participants: form.participants.map((p, j) => (j === i ? { ...p, ...patch } : p)) })

  return (
    <div className={styles.form}>
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

      <section className={styles.section} aria-labelledby="items-label">
        <h2 id="items-label" className={styles.label}>What are we testing?</h2>
        {form.testItems.map((item, i) => (
          <div key={i} className={styles.card} role="group" aria-label={`Test item ${i + 1}`}>
            <div className={styles.cardHead}>
              <h3 className={styles.cardTitle}>Test Item {i + 1}</h3>
              {!readOnly && form.testItems.length > 1 && (
                <Button kind="ghost" size="sm" onClick={() => onChange({ ...form, testItems: form.testItems.filter((_, j) => j !== i) })}>
                  Remove test item
                </Button>
              )}
            </div>
            <TextArea
              id={`item-${i}-description`}
              labelText="Description"
              placeholder="The feature, flow, or concept, and what you want to learn"
              rows={3}
              readOnly={readOnly}
              value={item.description}
              onChange={(e) => setItem(i, { description: e.target.value })}
            />
            <div className={styles.outcomes}>
              <span className={styles.fieldLabel} id={`item-${i}-outcomes`}>Outcomes expected</span>
              {item.outcomes.map((outcome, k) => (
                <div key={k} className={styles.outcomeRow}>
                  <TextInput
                    id={`item-${i}-outcome-${k}`}
                    labelText={`Outcome ${k + 1} of test item ${i + 1}`}
                    hideLabel
                    placeholder="What would success look like?"
                    readOnly={readOnly}
                    value={outcome}
                    onChange={(e) => setItem(i, { outcomes: item.outcomes.map((o, j) => (j === k ? e.target.value : o)) })}
                  />
                  {!readOnly && (
                    <Button
                      kind="ghost"
                      size="lg"
                      hasIconOnly
                      renderIcon={Close}
                      iconDescription="Remove outcome"
                      disabled={item.outcomes.length === 1}
                      onClick={() => setItem(i, { outcomes: item.outcomes.filter((_, j) => j !== k) })}
                    />
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button className={styles.add} kind="ghost" size="sm" onClick={() => setItem(i, { outcomes: [...item.outcomes, ''] })}>
                  + Add outcome
                </Button>
              )}
            </div>
          </div>
        ))}
        {!readOnly && (
          <Button className={styles.add} kind="ghost" size="sm" onClick={() => onChange({ ...form, testItems: [...form.testItems, blankItem()] })}>
            + Add test item
          </Button>
        )}
      </section>

      <section className={styles.section} aria-labelledby="participants-label">
        <h2 id="participants-label" className={styles.label}>Participants</h2>
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="Participants">
            <div className={styles.row} role="row">
              {['Name', 'Role or segment', 'Email', 'Phone', 'Session date'].map((h) => (
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
                  <TextInput id={`p-date-${i}`} labelText={`Session date of participant ${i + 1}`} hideLabel type="date" readOnly={readOnly} value={p.sessionDate} onChange={(e) => setParticipant(i, { sessionDate: e.target.value })} />
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
    </div>
  )
}
