import { Button, InlineNotification, Loading, Tag } from '@carbon/react'
import type { Member, MemberRole, Team } from '../../api/client'
import { RightPanel } from '../../components/RightPanel'
import { InvitePanel, type InviteInput } from './InvitePanel'
import { approvalsLine, initials, ROLE_LABEL, TEAM_ROLE_LABEL, type TeamChoice } from './peopleLogic'
import { PersonPanel } from './PersonPanel'
import styles from './PeopleView.module.scss'

export type PeopleViewProps = {
  state: 'loading' | 'error' | 'ready'
  members: Member[]
  teams: Team[]
  myEmail?: string
  /** Roles come from sign-in groups (read-only here). */
  rolesManaged: boolean
  /** Places in teams other than the default come from sign-in groups. */
  teamsManaged: boolean
  errorText?: string
  notice?: string
  busy: boolean
  /** The panel open, if any: an invitation, or a person by membership id. */
  panel: { type: 'invite' } | { type: 'person'; id: string } | null
  panelError?: string
  onInviteOpen: () => void
  onPersonOpen: (id: string) => void
  onClosePanel: () => void
  onInvite: (input: InviteInput) => void
  onSavePerson: (id: string, change: { role?: MemberRole; teams?: TeamChoice }) => void
  onRemove: (id: string) => void
}

// Presentational: who is in the workspace, their role, teams and approvals. Everything is edited in a right-hand panel, as a draft that Save commits.
export function PeopleView(p: PeopleViewProps) {
  const openId = p.panel?.type === 'person' ? p.panel.id : undefined
  const person = openId ? p.members.find((m) => m.id === openId) : undefined
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <p className={styles.intro}>Who can use Signal Flow, their role in the workspace and the teams they belong to. Invite someone by their email address; they sign in with that account. Approvals are set under Approvals.</p>
        </div>
        <Button kind="primary" size="md" onClick={p.onInviteOpen} data-testid="invite-person">Invite person</Button>
      </div>
      {p.rolesManaged && (
        <InlineNotification kind="info" lowContrast hideCloseButton title="Roles come from your sign-in groups" subtitle="Your identity provider decides who can use Signal Flow and as what. Change a person's access there; it applies at their next sign-in." />
      )}
      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={p.errorText} />}
      {p.notice && <InlineNotification kind="success" lowContrast hideCloseButton title="Saved" subtitle={p.notice} data-testid="people-notice" />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading people" />}
      {p.state === 'ready' && (
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="People" data-testid="people-table">
            <div className={styles.row} role="row">
              <div className={`${styles.headCell} ${styles.personCol}`} role="columnheader">Person</div>
              <div className={`${styles.headCell} ${styles.roleCol}`} role="columnheader">Workspace role</div>
              <div className={`${styles.headCell} ${styles.teamsCol}`} role="columnheader">Teams</div>
              <div className={`${styles.headCell} ${styles.approvalsCol}`} role="columnheader">Approvals</div>
            </div>
            {p.members.map((m) => {
              const you = !!p.myEmail && m.email.toLowerCase() === p.myEmail.toLowerCase()
              const line = approvalsLine(m.approvals)
              return (
                <div key={m.id} className={styles.row} role="row" data-testid={`person-${m.email}`} data-selected={openId === m.id ? true : undefined}>
                  <div className={`${styles.cell} ${styles.personCol}`} role="rowheader">
                    <span className={styles.avatar} aria-hidden="true">{initials(m.displayName || m.email)}</span>
                    <div className={styles.who}>
                      <p className={styles.name}>
                        <Button kind="ghost" size="sm" className={styles.nameButton} data-testid={`open-person-${m.email}`} onClick={() => p.onPersonOpen(m.id)}>{m.displayName}</Button>
                        {you && <span className={styles.you}>(you)</span>}
                        {m.status === 'invited' && <Tag size="sm" type="blue" className={styles.tag}>Invited</Tag>}
                        {m.external && <Tag size="sm" type="gray" className={styles.tag}>External</Tag>}
                      </p>
                      <p className={styles.email}>{m.email}</p>
                    </div>
                  </div>
                  <div className={`${styles.cell} ${styles.roleCol}`} role="cell">{m.external ? 'Viewer' : ROLE_LABEL[m.role]}</div>
                  <div className={`${styles.cell} ${styles.teamsCol}`} role="cell">
                    {m.external ? (
                      <span className={styles.muted}>Only launches they approve</span>
                    ) : m.teams.length ? (
                      <span className={styles.chips}>{m.teams.map((t) => <Tag key={t.teamId} size="sm" type="outline" title={`${TEAM_ROLE_LABEL[t.role]} in ${t.name}`}>{t.name}</Tag>)}</span>
                    ) : (
                      <span className={styles.muted}>No team</span>
                    )}
                  </div>
                  <div className={`${styles.cell} ${styles.approvalsCol}`} role="cell" data-testid={`approvals-${m.email}`}>{line ? <span className={styles.approvalsText}>{line}</span> : <span className={styles.muted}>—</span>}</div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <RightPanel open={p.panel?.type === 'invite'} heading="Invite person" label="People" onClose={p.onClosePanel}>
        {p.panel?.type === 'invite' && <InvitePanel teams={p.teams} members={p.members} busy={p.busy} error={p.panelError} onCancel={p.onClosePanel} onSave={p.onInvite} />}
      </RightPanel>
      <RightPanel open={!!person} heading={person?.displayName ?? 'Person'} label="People" onClose={p.onClosePanel}>
        {person && (
          <PersonPanel
            key={person.id}
            member={person}
            teams={p.teams}
            isYou={!!p.myEmail && person.email.toLowerCase() === p.myEmail.toLowerCase()}
            rolesManaged={p.rolesManaged}
            teamsManaged={p.teamsManaged}
            busy={p.busy}
            error={p.panelError}
            onCancel={p.onClosePanel}
            onSave={(change) => p.onSavePerson(person.id, change)}
            onRemove={() => p.onRemove(person.id)}
          />
        )}
      </RightPanel>
    </div>
  )
}
