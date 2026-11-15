import { Button, Checkbox, ContentSwitcher, InlineNotification, Switch, TextInput } from '@carbon/react'
import { useState } from 'react'
import type { Member, MemberRole, Team } from '../../api/client'
import { emailProblem, ROLE_HELP, ROLE_LABEL, type TeamChoice } from './peopleLogic'
import { TeamPicker } from './TeamPicker'
import parts from '../../components/PanelParts.module.scss'

const ROLES: MemberRole[] = ['owner', 'editor', 'viewer']
export type InviteInput = { email: string; role: MemberRole; external: boolean; teams: TeamChoice }

// Invite a person: their email, whether they are from outside the company, their workspace role and their teams. Nothing is saved until Save.
export function InvitePanel({ teams, members, busy, error, onSave, onCancel }: { teams: Team[]; members: Member[]; busy: boolean; error?: string; onSave: (input: InviteInput) => void; onCancel: () => void }) {
  const [email, setEmail] = useState('')
  const [external, setExternal] = useState(false)
  const [role, setRole] = useState<MemberRole>('editor')
  const [chosen, setChosen] = useState<TeamChoice>(() => Object.fromEntries(teams.filter((t) => t.isDefault).map((t) => [t.id, 'editor' as MemberRole])))
  const problem = emailProblem(email, members)
  const save = () => onSave({ email: email.trim(), role: external ? 'viewer' : role, external, teams: external ? {} : chosen })
  return (
    <div className={parts.body} data-testid="invite-panel">
      <div className={parts.scroll}>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} />}
      <section className={parts.section}>
        <TextInput id="invite-email" type="email" labelText="Email address" placeholder="name@example.com" value={email} invalid={!!problem} invalidText={problem ?? ''} onChange={(e) => setEmail(e.target.value)} />
        <Checkbox id="invite-external" labelText="From outside the company" checked={external} onChange={(_, { checked }) => setExternal(checked)} />
        <p className={parts.note}>A viewer who can reach only the launches they’re asked to approve. This is set now and cannot be changed later.</p>
        {external && <p className={parts.note}>External people don’t join teams. They see a launch only when they’re asked to approve it.</p>}
      </section>
      {!external && (
        <>
          <section className={parts.section} aria-label="Workspace role">
            <h3 className={parts.heading}>Workspace role</h3>
            <ContentSwitcher size="sm" selectedIndex={ROLES.indexOf(role)} onChange={(e) => {
              const next = e.name as MemberRole
              setRole(next)
              // A team ticked with the previous role follows the new one, until it is set on its own.
              setChosen((cur) => Object.fromEntries(Object.entries(cur).map(([id, r]) => [id, r === role ? next : r])) as TeamChoice)
            }}>
              {ROLES.map((r) => <Switch key={r} name={r} text={ROLE_LABEL[r]} data-testid={`invite-role-${r}`} />)}
            </ContentSwitcher>
            <p className={parts.help}>{ROLE_HELP[role]}</p>
          </section>
          <section className={parts.section} aria-label="Teams">
            <h3 className={parts.heading}>Teams</h3>
            <TeamPicker teams={teams} value={chosen} defaultRole={role} idPrefix="invite" onChange={setChosen} />
          </section>
        </>
      )}
      </div>
      <div className={parts.actions}>
        <Button kind="secondary" size="md" onClick={onCancel} data-testid="cancel-invite">Cancel</Button>
        <Button kind="primary" size="md" disabled={!email.trim() || !!problem || busy} onClick={save} data-testid="save-invite">{busy ? 'Saving…' : 'Invite'}</Button>
      </div>
    </div>
  )
}
