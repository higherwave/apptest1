import { Button, InlineNotification, Loading, Modal, Tag, Toggle } from '@carbon/react'
import type { ApprovalPerson, ApprovalsOverview, ApprovalStep, ApprovalStepInput, ApprovalTeamCell } from '../../api/client'
import { RightPanel } from '../../components/RightPanel'
import { SettingsHeader } from '../settings/SettingsHeader'
import { backupsFor } from './approvalsLogic'
import { StepPanel } from './StepPanel'
import styles from './ApprovalsView.module.scss'

export type ApprovalsViewProps = {
  state: 'loading' | 'error' | 'ready'
  overview?: ApprovalsOverview
  errorText?: string
  notice?: string
  busy: boolean
  /** The step open in the panel, if any. */
  openStep: string | null
  panelError?: string
  onOpen: (step: string) => void
  onClosePanel: () => void
  onSave: (step: string, input: ApprovalStepInput) => void
  /** The Use backup toggle of a person: turning it on asks first (the dialog names who covers), turning it off acts at once. */
  awayFor: { userId: string; name: string; covering: string[] } | null
  onAway: (person: ApprovalPerson, on: boolean) => void
  onConfirmAway: () => void
  onCancelAway: () => void
}

// The Use backup switch of one approver. It is the person's, so it covers every step they approve; it is disabled, with the reason, when a step of theirs has no backup.
function UseBackup({ person, overview, busy, id, onAway }: { person: ApprovalPerson; overview: ApprovalsOverview; busy: boolean; id: string; onAway: ApprovalsViewProps['onAway'] }) {
  const can = backupsFor(overview, person.userId).length > 0 || person.unavailable
  return (
    <span className={styles.useBackup} title={can ? undefined : 'Add a backup for every step this person approves before marking them away.'} data-testid={id}>
      <Toggle id={id} labelText={`Use backup while ${person.name} is away`} hideLabel labelA="" labelB="" toggled={person.unavailable} disabled={!can || busy} onToggle={(on) => { if (on !== person.unavailable) onAway(person, on) }} />
      {!can && <span className={styles.noBackup}>No backup</span>}
    </span>
  )
}

function TeamCell({ cell, step, overview, busy, onAway }: { cell: ApprovalTeamCell; step: ApprovalStep; overview: ApprovalsOverview; busy: boolean; onAway: ApprovalsViewProps['onAway'] }) {
  if (cell.mode === 'off') return <span className={styles.off}>Not used</span>
  if (cell.mode === 'custom' && cell.approver) {
    return (
      <>
        <span className={styles.who}>{cell.approver.name}</span>
        <span className={styles.sub}>Team approver{cell.approver.unavailable ? ' · away' : ''}</span>
        <UseBackup person={cell.approver} overview={overview} busy={busy} id={`use-backup-${step.key}-${cell.teamId}`} onAway={onAway} />
      </>
    )
  }
  if (cell.state === 'gap') return <span className={styles.gap}>No approver</span>
  return <span className={styles.default}>Default</span>
}

// Presentational: who approves each launch step, for the workspace and per team. A step a team uses that nobody approves is a gap, shown in the grid.
export function ApprovalsView(p: ApprovalsViewProps) {
  const o = p.overview
  const open = o?.steps.find((s) => s.key === p.openStep)
  return (
    <div className={styles.page}>
      <SettingsHeader />
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Approvals</h2>
          <p className={styles.intro}>
            Who approves each step of a launch. Choose one approver for the workspace, and a backup who steps in while the approver is away. A team can have its own approver for a step, or not use it. A step a team uses
            that nobody approves is a gap, here and on its launches.
          </p>
        </div>
        {o && <p className={styles.summary} data-gaps={o.gaps} data-testid="gap-summary">{o.gaps === 0 ? 'Every step has an approver' : `${o.gaps} ${o.gaps === 1 ? 'step' : 'steps'} without an approver`}</p>}
      </header>
      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={p.errorText} />}
      {p.notice && <InlineNotification kind="success" lowContrast hideCloseButton title="Saved" subtitle={p.notice} data-testid="approvals-notice" />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading approvals" />}
      {p.state === 'ready' && o && (
        <div className={styles.tableWrap}>
          <div className={styles.grid} role="table" aria-label="Who approves each step, by team" data-testid="approvals-grid">
            <div className={styles.row} role="row">
              <div className={`${styles.head1} ${styles.stepCol}`} role="columnheader">Step</div>
              <div className={`${styles.head1} ${styles.approverCol}`} role="columnheader">Workspace approver</div>
              <div className={`${styles.head1} ${styles.backupCol}`} role="columnheader">Use backup</div>
              {o.teams.map((t) => <div key={t.id} className={`${styles.head1} ${styles.teamCol}`} role="columnheader">{t.name}</div>)}
            </div>
            {o.steps.map((s) => (
              <div key={s.key} className={styles.row} role="row" data-testid={`step-row-${s.key}`} data-gap={s.teams.some((t) => t.state === 'gap') || undefined}>
                <div className={`${styles.cell} ${styles.stepCol}`} role="rowheader">
                  <Button kind="ghost" size="sm" className={styles.stepButton} data-testid={`open-step-${s.key}`} onClick={() => p.onOpen(s.key)}>{s.label}</Button>
                  {!s.optional && <span className={styles.sub}>Always used</span>}
                </div>
                <div className={`${styles.cell} ${styles.approverCol}`} role="cell">
                  {s.approver ? (
                    <>
                      <span className={styles.who}>{s.approver.name}{s.approver.unavailable && <Tag size="sm" type="gray" className={styles.tag}>Away</Tag>}</span>
                      <span className={styles.sub}>{s.backup ? `Backup: ${s.backup.name}` : 'No backup'}</span>
                    </>
                  ) : (
                    <Button kind="ghost" size="sm" className={styles.choose} onClick={() => p.onOpen(s.key)}>Choose approver</Button>
                  )}
                </div>
                <div className={`${styles.cell} ${styles.backupCol}`} role="cell">
                  {s.approver && <UseBackup person={s.approver} overview={o} busy={p.busy} id={`use-backup-${s.key}`} onAway={p.onAway} />}
                </div>
                {s.teams.map((t) => (
                  <div key={t.teamId} className={`${styles.cell} ${styles.teamCol}`} role="cell" data-testid={`cell-${s.key}-${o.teams.find((x) => x.id === t.teamId)?.name}`} data-state={t.state} data-mode={t.mode}>
                    <TeamCell cell={t} step={s} overview={o} busy={p.busy} onAway={p.onAway} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <RightPanel open={!!open} heading={open ? `${open.label} approvers` : 'Approvers'} label="Approvals" onClose={p.onClosePanel}>
        {open && o && <StepPanel key={open.key} step={open} overview={o} busy={p.busy} error={p.panelError} onCancel={p.onClosePanel} onSave={(input) => p.onSave(open.key, input)} />}
      </RightPanel>

      <Modal
        open={!!p.awayFor}
        size="sm"
        modalHeading="Use the backup?"
        primaryButtonText={p.busy ? 'Saving…' : 'Use backup'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={p.busy}
        onRequestClose={p.onCancelAway}
        onRequestSubmit={p.onConfirmAway}
      >
        <p className={styles.confirm} data-testid="away-dialog">
          While {p.awayFor?.name} is away, {p.awayFor?.covering.join(', ')} {p.awayFor && p.awayFor.covering.length === 1 ? 'is' : 'are'} the approver{p.awayFor && p.awayFor.covering.length === 1 ? '' : 's'} for all their steps and will get the launch messages and answer requests. Each backup is emailed now. Switch it off when they return.
        </p>
      </Modal>
    </div>
  )
}
