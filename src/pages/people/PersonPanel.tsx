import { Button, ContentSwitcher, InlineNotification, Switch } from '@carbon/react'
import { useState } from 'react'
import type { Member, MemberRole, Team } from '../../api/client'
import { approvalsLine, personChange, ROLE_HELP, ROLE_LABEL, type TeamChoice } from './peopleLogic'
import { TeamPicker } from './TeamPicker'
import parts from '../../components/PanelParts.module.scss'

const ROLES: MemberRole[] = ['owner', 'editor', 'viewer']

// One person, edited as a draft: their workspace role and their teams (with their role in each). Their approvals are shown, never edited here: those are
// set under Approvals. Nothing is saved until Save; removing someone asks first and acts at once. Rendered with a key per person, so a draft never carries over.
export function PersonPanel({ member, teams, isYou, rolesManaged, teamsManaged, busy, error, onSave, onCancel, onRemove }: {
  member: Member
  teams: Team[]
  isYou: boolean
  /** Roles come from sign-in groups, so they are not changed here. */
  rolesManaged: boolean
  /** Places in teams other than the default come from sign-in groups. */
  teamsManaged: boolean
  busy: boolean
  error?: string
  onSave: (change: { role?: MemberRole; teams?: TeamChoice }) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [role, setRole] = useState<MemberRole>(member.role)
  const [chosen, setChosen] = useState<TeamChoice>(() => Object.fromEntries(member.teams.map((t) => [t.teamId, t.role])))
  const [confirming, setConfirming] = useState(false)
  const roleLocked = isYou || member.external || rolesManaged
  const change = personChange(member, { role, teams: member.external ? {} : chosen })
  return (
    <div className={parts.body} data-testid="person-panel" data-person={member.email}>
      <div className={parts.scroll}>
      <p className={parts.lead}>{member.email}{isYou && ' (you)'}</p>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} />}
      <section className={parts.section} aria-label="Workspace role">
        <h3 className={parts.heading}>Workspace role</h3>
        {member.external ? (
          <p className={parts.note}>Viewer (external). From outside the company; this is set when someone is invited and cannot be changed.</p>
        ) : (
          <>
            <ContentSwitcher size="sm" selectedIndex={ROLES.indexOf(role)} onChange={(e) => {
              const next = e.name as MemberRole
              setRole(next)
              // A team where they had the old role follows the new one (a team set apart stays as it is).
              setChosen((cur) => Object.fromEntries(Object.entries(cur).map(([id, r]) => [id, r === role ? next : r])) as TeamChoice)
            }}>
              {ROLES.map((r) => <Switch key={r} name={r} text={ROLE_LABEL[r]} disabled={roleLocked} data-testid={`person-role-${r}`} />)}
            </ContentSwitcher>
            <p className={parts.help}>{isYou ? 'You can’t change your own role.' : rolesManaged ? 'Roles come from your sign-in groups.' : ROLE_HELP[role]}</p>
          </>
        )}
      </section>
      {!member.external && (
        <section className={parts.section} aria-label="Teams">
          <h3 className={parts.heading}>Teams</h3>
          {teamsManaged && <p className={parts.note}>Places in teams other than the default come from your sign-in groups.</p>}
          <TeamPicker teams={teams} value={chosen} defaultRole={role} idPrefix="person" locked={(t) => teamsManaged && !t.isDefault} onChange={setChosen} />
        </section>
      )}
      <section className={parts.section} aria-label="Approvals">
        <h3 className={parts.heading}>Approvals</h3>
        {member.approvals.length ? <p className={parts.small} data-testid="person-approvals">{approvalsLine(member.approvals)}</p> : <p className={parts.help}>Not an approver for any step.</p>}
        <p className={parts.help} data-testid="approvals-hint">{member.approvals.length ? 'Approvals are changed in the Approvals tab.' : 'Add approvals in the Approvals tab.'}</p>
      </section>
      {!isYou && (
        <section className={parts.section} aria-label="Remove">
          <h3 className={parts.heading}>{member.status === 'invited' ? 'Cancel the invite' : 'Remove from the workspace'}</h3>
          {confirming ? (
            <div className={parts.confirmBox} data-testid="remove-confirm">
              <p className={parts.help}>
                {member.status === 'invited' ? 'They won’t be able to sign in with this invitation.' : 'They lose access right away and are signed out.'}
                {member.approvals.length > 0 && ` Their ${member.approvals.length} approval ${member.approvals.length === 1 ? 'step' : 'steps'} will pass to the backup or show as a gap.`}
              </p>
              <div className={parts.confirmActions}>
                <Button kind="danger" size="sm" disabled={busy} onClick={onRemove} data-testid="confirm-remove">{member.status === 'invited' ? 'Cancel invite' : 'Remove'}</Button>
                <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
              </div>
            </div>
          ) : (
            <div><Button kind="danger--tertiary" size="sm" onClick={() => setConfirming(true)} data-testid="remove-person">{member.status === 'invited' ? 'Cancel invite' : 'Remove from workspace'}</Button></div>
          )}
        </section>
      )}
      </div>
      <div className={parts.actions}>
        <Button kind="secondary" size="md" onClick={onCancel} data-testid="cancel-person">Cancel</Button>
        <Button kind="primary" size="md" disabled={busy} onClick={() => (change ? onSave(change) : onCancel())} data-testid="save-person">{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </div>
  )
}
