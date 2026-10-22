import { Close } from '@carbon/icons-react'
import { Button, Dropdown, InlineNotification, Loading, Modal, Tag, TextInput } from '@carbon/react'
import type { Member, MemberRole } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import styles from './MembersView.module.scss'

const ROLES: { key: MemberRole; label: string; help: string }[] = [
  { key: 'owner', label: 'Owner', help: 'Everything, including inviting people and changing roles' },
  { key: 'editor', label: 'Editor', help: 'Create and change projects, themes, requirements and stories' },
  { key: 'viewer', label: 'Viewer', help: 'Look, but not change anything' },
]
const roleOf = (key: MemberRole) => ROLES.find((r) => r.key === key)!

export type MembersViewProps = {
  state: 'loading' | 'error' | 'ready'
  members: Member[]
  myEmail?: string
  isOwner: boolean
  errorText?: string
  notice?: string
  email: string
  role: MemberRole
  inviting: boolean
  removing: Member | null
  removePending: boolean
  onEmail: (v: string) => void
  onRole: (r: MemberRole) => void
  onInvite: () => void
  onChangeRole: (m: Member, r: MemberRole) => void
  onAskRemove: (m: Member) => void
  onCancelRemove: () => void
  onConfirmRemove: () => void
}

// Presentational: who is in the workspace, and for owners the invite form and the role and remove controls.
export function MembersView(p: MembersViewProps) {
  return (
    <div className={styles.page}>
      <ProjectHeader title="Members" description="Who can use Signal Flow. Invite someone by their Google email address; they sign in with that account." />

      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={p.errorText} />}
      {p.notice && <InlineNotification kind="success" lowContrast hideCloseButton title="Invited" subtitle={p.notice} />}

      {p.isOwner && (
        <section className={styles.invite} aria-label="Invite someone">
          <TextInput
            id="invite-email"
            type="email"
            labelText="Google email address"
            placeholder="name@example.com"
            value={p.email}
            onChange={(e) => p.onEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && p.email.trim() && !p.inviting && p.onInvite()}
          />
          <Dropdown
            id="invite-role"
            titleText="Role"
            label="Role"
            size="lg"
            items={ROLES}
            itemToString={(r) => r?.label ?? ''}
            selectedItem={roleOf(p.role)}
            onChange={({ selectedItem }) => selectedItem && p.onRole(selectedItem.key)}
          />
          <Button kind="primary" size="md" disabled={!p.email.trim() || p.inviting} onClick={p.onInvite}>
            {p.inviting ? 'Inviting…' : 'Invite'}
          </Button>
        </section>
      )}
      <p className={styles.roles}>
        {ROLES.map((r) => (
          <span key={r.key}>
            <strong>{r.label}:</strong> {r.help}.{' '}
          </span>
        ))}
      </p>

      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading members" />}
      {p.state === 'ready' && (
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="Members">
            <div className={styles.row} role="row">
              {['Member', 'Status', 'Role'].map((h) => (
                <div key={h} className={styles.head} role="columnheader">{h}</div>
              ))}
              <div className={styles.head} role="columnheader"><span className={styles.srOnly}>Remove</span></div>
            </div>
            {p.members.map((m) => (
              <div key={m.id} className={styles.row} role="row" data-testid={`member-${m.email}`}>
                <div role="cell">
                  <p className={styles.name}>{m.displayName}{m.email === p.myEmail ? ' (you)' : ''}</p>
                  <p className={styles.email}>{m.email}</p>
                </div>
                <div role="cell">
                  <Tag size="sm" type={m.status === 'active' ? 'green' : 'warm-gray'}>{m.status === 'active' ? 'Signed in' : 'Invited'}</Tag>
                </div>
                <div role="cell">
                  {p.isOwner ? (
                    <Dropdown
                      id={`role-${m.id}`}
                      titleText={`Role of ${m.email}`}
                      hideLabel
                      label="Role"
                      size="sm"
                      items={ROLES}
                      itemToString={(r) => r?.label ?? ''}
                      selectedItem={roleOf(m.role)}
                      onChange={({ selectedItem }) => selectedItem && selectedItem.key !== m.role && p.onChangeRole(m, selectedItem.key)}
                    />
                  ) : (
                    <span>{roleOf(m.role).label}</span>
                  )}
                </div>
                <div role="cell" className={styles.remove}>
                  {p.isOwner && <Button kind="ghost" size="lg" hasIconOnly renderIcon={Close} iconDescription={`Remove ${m.email}`} tooltipPosition="left" onClick={() => p.onAskRemove(m)} />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal
        open={p.removing !== null}
        danger
        size="sm"
        modalHeading={`Remove ${p.removing?.email ?? 'this person'}?`}
        primaryButtonText={p.removePending ? 'Removing…' : 'Remove'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={p.removePending}
        onRequestClose={p.onCancelRemove}
        onRequestSubmit={p.onConfirmRemove}
      >
        <p className={styles.confirm}>They lose access right away and are signed out. You can invite them again later.</p>
      </Modal>
    </div>
  )
}
