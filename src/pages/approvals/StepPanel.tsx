import { Button, ContentSwitcher, InlineNotification, Select, SelectItem, Switch } from '@carbon/react'
import { useState } from 'react'
import type { ApprovalsOverview, ApprovalStep, ApprovalStepInput } from '../../api/client'
import { draftProblem, draftResult, type TeamDraft } from './approvalsLogic'
import parts from '../../components/PanelParts.module.scss'
import styles from './ApprovalsView.module.scss'

const MODES: { key: TeamDraft['mode']; label: string }[] = [
  { key: 'default', label: 'Default' },
  { key: 'custom', label: 'Team approver' },
  { key: 'off', label: 'Not used' },
]

function PersonSelect({ id, label, value, none, people, exclude, noExternal, disabled, onChange }: { id: string; label: string; value: string; none: string; people: ApprovalsOverview['people']; exclude?: string; noExternal?: boolean; disabled?: boolean; onChange: (v: string) => void }) {
  return (
    <Select id={id} labelText={label} size="md" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <SelectItem value="" text={none} />
      {people.filter((p) => p.userId !== exclude).map((p) => (
        <SelectItem key={p.userId} value={p.userId} disabled={!!noExternal && p.external} text={`${p.name} · ${p.email}${p.external ? ' · external' : ''}${noExternal && p.external ? ' (team only)' : ''}`} />
      ))}
    </Select>
  )
}

// One step, edited as a draft: the workspace's approver and backup, and for each team the workspace's, its own or not used. Nothing is saved until Save.
// Rendered with a key per step, so the draft starts from that step and never carries over to another.
export function StepPanel({ step, overview, busy, error, onSave, onCancel }: { step: ApprovalStep; overview: ApprovalsOverview; busy: boolean; error?: string; onSave: (input: ApprovalStepInput) => void; onCancel: () => void }) {
  const [approver, setApprover] = useState(step.approver?.userId ?? '')
  const [backup, setBackup] = useState(step.backup?.userId ?? '')
  const [teams, setTeams] = useState<Record<string, TeamDraft>>(() =>
    Object.fromEntries(step.teams.map((t) => [t.teamId, { mode: t.mode, approver: t.approver?.userId ?? '', backup: t.backup?.userId ?? '' }])),
  )
  const setTeam = (id: string, patch: Partial<TeamDraft>) => setTeams((cur) => ({ ...cur, [id]: { ...cur[id], ...patch } }))
  const problem = draftProblem(approver, backup, teams)
  const nameOf = (id: string) => overview.people.find((p) => p.userId === id)?.name ?? 'Someone'
  const save = () =>
    onSave({
      approver: approver || null,
      backup: backup || null,
      teams: Object.fromEntries(Object.entries(teams).map(([id, t]) => [id, { mode: t.mode, approver: t.mode === 'custom' ? t.approver || null : null, backup: t.mode === 'custom' ? t.backup || null : null }])),
    })
  return (
    <div className={parts.body} data-testid="step-panel" data-step={step.key}>
      <div className={parts.scroll}>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} />}
      <section className={parts.section} aria-label="Workspace approver">
        <h3 className={parts.heading}>Workspace approver</h3>
        <p className={parts.note}>Approves this step for every team that does not choose its own. The backup answers only while the approver is marked away.</p>
        <PersonSelect id="approver-select" label="Approver" value={approver} none="No approver" people={overview.people} noExternal onChange={(v) => { setApprover(v); if (!v) setBackup('') }} />
        <PersonSelect id="backup-select" label="Backup" value={backup} none="No backup" people={overview.people} exclude={approver} noExternal disabled={!approver} onChange={setBackup} />
      </section>
      <section className={parts.section} aria-label="Teams">
        <h3 className={parts.heading}>Teams</h3>
        <p className={parts.note}>{overview.teams.length ? 'Each team uses the workspace approver unless you choose otherwise.' : 'No teams yet.'}</p>
        {overview.teams.map((t) => {
          const d = teams[t.id] ?? { mode: 'default' as const, approver: '', backup: '' }
          const r = draftResult(approver, d, step.optional)
          return (
            <div key={t.id} className={styles.teamBlock} data-testid={`team-block-${t.name}`}>
              <div className={styles.teamHead}>
                <p className={styles.teamName}>{t.name}</p>
                <p className={styles.resultLine} data-kind={r.kind}>{r.kind === 'off' ? 'Step not used by this team' : r.kind === 'approver' ? `Approved by ${nameOf(r.userId!)}` : 'No approver'}</p>
              </div>
              <ContentSwitcher size="sm" selectedIndex={MODES.findIndex((m) => m.key === d.mode)} onChange={(e) => setTeam(t.id, { mode: e.name as TeamDraft['mode'] })}>
                {MODES.map((m) => (
                  <Switch key={m.key} name={m.key} text={m.label} data-testid={`team-mode-${t.name}-${m.key}`} disabled={m.key === 'off' && !step.optional} />
                ))}
              </ContentSwitcher>
              {d.mode === 'custom' && (
                <div className={styles.teamPickers}>
                  <PersonSelect id={`team-approver-${t.id}`} label={`${t.name} approver`} value={d.approver} none="Choose an approver" people={overview.people} onChange={(v) => setTeam(t.id, { approver: v, backup: v ? d.backup : '' })} />
                  <PersonSelect id={`team-backup-${t.id}`} label={`${t.name} backup`} value={d.backup} none="No backup" people={overview.people} exclude={d.approver} disabled={!d.approver} onChange={(v) => setTeam(t.id, { backup: v })} />
                </div>
              )}
            </div>
          )
        })}
        {!step.optional && <p className={parts.note}>The final decision is always used, so it cannot be set to Not used.</p>}
      </section>
      {problem && <p className={styles.problem} role="alert">{problem}</p>}
      </div>
      <div className={parts.actions}>
        <Button kind="secondary" size="md" onClick={onCancel} data-testid="cancel-step">Cancel</Button>
        <Button kind="primary" size="md" disabled={!!problem || busy} onClick={save} data-testid="save-step">{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  )
}
