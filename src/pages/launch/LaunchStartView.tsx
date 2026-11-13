import { Button, InlineNotification, Loading, TextInput } from '@carbon/react'
import { useState } from 'react'
import { ProjectHeader } from '../project/ProjectHeader'
import styles from './LaunchView.module.scss'

export type LaunchStartViewProps = {
  state: 'loading' | 'ready'
  canCreate: boolean
  whyNot: string | null
  busy: boolean
  errorText?: string
  projectName?: string
  onStart: (name: string, targetDate: string | null) => Promise<boolean>
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

// Presentational: a project with no launch yet. An editor of its team starts one; everyone else is told why they cannot.
export function LaunchStartView(p: LaunchStartViewProps) {
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const dateOk = date.trim() === '' || DAY.test(date.trim())
  return (
    <div className={styles.page}>
      <ProjectHeader title="Launch" description="The go signals from each function, with the evidence behind them. Everyone sees every section; each step’s reviewer answers their own." />
      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Not started" subtitle={p.errorText} />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading the launch" />}
      {p.state === 'ready' && (
        <section className={styles.start} aria-label="Start the launch" data-testid="launch-start">
          <h2 className={styles.launchName}>No launch yet</h2>
          <p className={styles.notes}>
            Start the launch to ask each function for its go signal. Reviewers are set up once under Admin, Members, Reviewers; a step nobody covers shows as “approver missing”. Functions can follow the project from now,
            well before anything is asked of them.
          </p>
          {p.canCreate ? (
            <div className={styles.modalForm}>
              <TextInput id="start-name" labelText="Name (optional)" placeholder={p.projectName ?? 'The project’s name'} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
              <TextInput id="start-date" labelText="Target date (optional)" placeholder="2026-12-01" helperText="A day, like 2026-12-01." value={date} invalid={!dateOk} invalidText="Use a date like 2026-12-01." onChange={(e) => setDate(e.target.value)} />
              <div>
                <Button kind="primary" size="md" disabled={p.busy || !dateOk} data-testid="start-launch" onClick={() => void p.onStart(name.trim(), date.trim() || null)}>
                  {p.busy ? 'Starting…' : 'Start the launch'}
                </Button>
              </div>
            </div>
          ) : (
            <p className={styles.small}>{p.whyNot}</p>
          )}
        </section>
      )}
    </div>
  )
}
