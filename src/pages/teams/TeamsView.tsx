import { Close } from '@carbon/icons-react'
import { Button, Checkbox, Dropdown, InlineNotification, Loading, Modal, Tag, TextInput } from '@carbon/react'
import type { Member, MemberRole, Team } from '../../api/client'
import { SettingsHeader } from '../settings/SettingsHeader'
import styles from './TeamsView.module.scss'

// A role inside a team. The workspace's owners are leaders who see every team; a role here is what a person may do in this team's projects.
const ROLES: { key: MemberRole; label: string; help: string }[] = [
  { key: 'owner', label: 'Owner', help: 'Everything in this team’s projects' },
  { key: 'editor', label: 'Editor', help: 'Create and change this team’s projects, themes, requirements and stories' },
  { key: 'viewer', label: 'Viewer', help: 'Look at this team’s projects, but not change anything' },
]
const roleOf = (key: MemberRole) => ROLES.find((r) => r.key === key)!
const roleItem = (r: (typeof ROLES)[number]) => (
  <span className={styles.roleItem}>
    <span className={styles.roleName}>{r.label}</span>
    <span className={styles.roleHelp}>{r.help}</span>
  </span>
)

export type TeamsViewProps = {
  state: 'loading' | 'error' | 'ready'
  teams: Team[]
  /** Everyone in the workspace, to pick who to add to a team. */
  people: Member[]
  selected?: Team
  errorText?: string
  /** True when people's places in non-default teams come from sign-in groups (SSO_TEAM_GROUP_PREFIX). */
  groupsManage: boolean
  newName: string
  nameDraft: string
  addPerson: Member | null
  addRole: MemberRole
  busy: boolean
  confirmDelete: boolean
  /** The steps of a launch and which of them this team does not use (Admin, Members, Reviewers shows who covers them). */
  launchSteps?: { steps: { key: string; label: string; optional: boolean }[]; off: string[] }
  onLaunchStep: (step: string, used: boolean) => void
  /** The channel box (a name, no #) and saving it; empty clears the team's channel. */
  slackDraft: string
  onSlackDraft: (v: string) => void
  onSaveSlack: () => void
  onSelect: (id: string) => void
  onNewName: (v: string) => void
  onCreate: () => void
  onNameDraft: (v: string) => void
  onRename: () => void
  onAddPerson: (m: Member | null) => void
  onAddRole: (r: MemberRole) => void
  onAdd: () => void
  onChangeRole: (memberId: string, r: MemberRole) => void
  onRemovePerson: (memberId: string) => void
  onMoveProject: (projectId: string, toTeamId: string) => void
  onAskDelete: () => void
  onCancelDelete: () => void
  onDelete: () => void
}

// Presentational: the teams of the workspace for its owners: who is in each, with what role, and which projects it holds.
export function TeamsView(p: TeamsViewProps) {
  const team = p.selected
  const inTeam = new Set(team?.members.map((m) => m.memberId))
  const candidates = p.people.filter((m) => !inTeam.has(m.id))
  const others = p.teams.filter((t) => t.id !== team?.id)
  // In a team whose people come from sign-in groups, the list is shown but not edited here.
  const locked = p.groupsManage && !!team && !team.isDefault
  return (
    <div className={styles.page}>
      <SettingsHeader />
      <p className={styles.intro}>
        A team owns projects, and a person has a role in each team they belong to. Owners of the workspace see every team’s projects; everyone else sees only their own teams’.
        Anyone invited to the workspace starts in the default team.
      </p>
      {p.groupsManage && (
        <InlineNotification kind="info" lowContrast hideCloseButton title="People come from your sign-in groups" subtitle="Who is in each team (except the default team) and with what role follows their groups at every sign-in. Change it in your identity provider. Teams and their projects are still managed here." />
      )}
      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={p.errorText} />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading teams" />}

      {p.state === 'ready' && (
        <>
          <section className={styles.bar} aria-label="Choose or add a team">
            <Dropdown
              id="team-pick"
              titleText="Team"
              label="Choose a team"
              size="lg"
              items={p.teams}
              itemToString={(t) => (t ? `${t.name} · ${t.members.length} ${t.members.length === 1 ? 'person' : 'people'} · ${t.projects.length} ${t.projects.length === 1 ? 'project' : 'projects'}` : '')}
              selectedItem={team ?? null}
              onChange={({ selectedItem }) => selectedItem && p.onSelect(selectedItem.id)}
            />
            <div className={styles.newTeam}>
              <TextInput id="new-team" labelText="New team" placeholder="e.g. Support" value={p.newName} maxLength={60} onChange={(e) => p.onNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && p.newName.trim() && !p.busy && p.onCreate()} />
              <Button kind="primary" size="md" disabled={!p.newName.trim() || p.busy} onClick={p.onCreate}>
                Add team
              </Button>
            </div>
          </section>

          {team && (
            <section className={styles.panel} aria-label={`${team.name} team`} data-testid={`team-${team.name}`}>
              <div className={styles.nameRow}>
                <TextInput id="team-name" labelText="Team name" value={p.nameDraft} maxLength={60} onChange={(e) => p.onNameDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && p.nameDraft.trim() !== team.name && p.nameDraft.trim() && !p.busy && p.onRename()} />
                <Button kind="secondary" size="md" disabled={!p.nameDraft.trim() || p.nameDraft.trim() === team.name || p.busy} onClick={p.onRename}>
                  Rename
                </Button>
                {team.isDefault ? <Tag size="sm" type="gray">Default team</Tag> : <Button kind="danger--ghost" size="md" onClick={p.onAskDelete}>Delete team</Button>}
              </div>

              <div data-testid="team-slack">
                <h2 className={styles.heading}>Slack channel for launches</h2>
                <p className={styles.note}>
                  Each launch of this team gets one thread here, with a reply when answers are asked for, a step is answered, the final decision is made or the brief reopens an answer. Leave it empty to post nothing. Invite the Signal Flow app to a private channel first.
                </p>
                <div className={styles.nameRow}>
                  <TextInput id="team-slack" labelText="Channel name" placeholder="launches" value={p.slackDraft} maxLength={80} onChange={(e) => p.onSlackDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && p.slackDraft.trim() !== (team.slackChannel ?? '') && !p.busy && p.onSaveSlack()} />
                  <Button kind="secondary" size="md" disabled={p.slackDraft.trim().replace(/^#/, '') === (team.slackChannel ?? '') || p.busy} onClick={p.onSaveSlack} data-testid="save-slack">
                    Save channel
                  </Button>
                </div>
              </div>

              {p.launchSteps && (
                <div data-testid="launch-steps">
                  <h2 className={styles.heading}>Launch steps</h2>
                  <p className={styles.note}>
                    The steps this team’s launches use. A step the team uses that nobody covers shows as “approver missing”, so turn a step off here only if the team never needs it. Who covers each step is set under Members, Reviewers.
                  </p>
                  <div className={styles.steps}>
                    {p.launchSteps.steps.map((s) => (
                      <Checkbox
                        key={s.key}
                        id={`launch-step-${s.key}`}
                        labelText={s.optional ? s.label : `${s.label} (always used)`}
                        checked={!s.optional || !p.launchSteps!.off.includes(s.key)}
                        disabled={!s.optional || p.busy}
                        onChange={(_, { checked }) => p.onLaunchStep(s.key, checked)}
                      />
                    ))}
                  </div>
                </div>
              )}

              <div>
                <h2 className={styles.heading}>People</h2>
                {team.members.length === 0 ? (
                  <p className={styles.note}>No one is in this team yet.</p>
                ) : (
                  <div className={styles.table} role="table" aria-label={`People in ${team.name}`}>
                    {team.members.map((m) => (
                      <div key={m.memberId} className={styles.row} role="row" data-testid={`team-member-${m.email}`}>
                        <div role="cell">
                          <p className={styles.name}>{m.displayName}</p>
                          <p className={styles.email}>{m.email}</p>
                        </div>
                        <div role="cell">
                          {locked ? (
                            <span>{roleOf(m.role).label}</span>
                          ) : (
                          <Dropdown
                            id={`team-role-${m.memberId}`}
                            titleText={`Role of ${m.email}`}
                            hideLabel
                            label="Role"
                            size="sm"
                            className={styles.roleDropdown}
                            items={ROLES}
                            itemToString={(r) => r?.label ?? ''}
                            itemToElement={roleItem}
                            selectedItem={roleOf(m.role)}
                            onChange={({ selectedItem }) => selectedItem && selectedItem.key !== m.role && p.onChangeRole(m.memberId, selectedItem.key)}
                          />
                          )}
                        </div>
                        <div role="cell" className={styles.remove}>
                          {!locked && <Button kind="ghost" size="lg" hasIconOnly renderIcon={Close} iconDescription={`Take ${m.email} out of ${team.name}`} tooltipPosition="left" onClick={() => p.onRemovePerson(m.memberId)} />}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {!locked && (
                <div className={styles.addRow}>
                  <Dropdown
                    id="team-add-person"
                    titleText="Add someone from the workspace"
                    label={candidates.length ? 'Choose a person' : 'Everyone is already in this team'}
                    size="md"
                    disabled={candidates.length === 0}
                    items={candidates}
                    itemToString={(m) => (m ? `${m.displayName} · ${m.email}` : '')}
                    selectedItem={p.addPerson && candidates.some((m) => m.id === p.addPerson?.id) ? p.addPerson : null}
                    onChange={({ selectedItem }) => p.onAddPerson(selectedItem ?? null)}
                  />
                  <Dropdown
                    id="team-add-role"
                    titleText="Role"
                    label="Role"
                    size="md"
                    className={styles.roleDropdown}
                    items={ROLES}
                    itemToString={(r) => r?.label ?? ''}
                    itemToElement={roleItem}
                    selectedItem={roleOf(p.addRole)}
                    onChange={({ selectedItem }) => selectedItem && p.onAddRole(selectedItem.key)}
                  />
                  <Button kind="primary" size="md" disabled={!p.addPerson || p.busy} onClick={p.onAdd}>
                    Add to team
                  </Button>
                </div>
                )}
              </div>

              <div>
                <h2 className={styles.heading}>Projects</h2>
                {team.projects.length === 0 ? (
                  <p className={styles.note}>This team has no projects. Move one here from another team’s list, or create one from Projects.</p>
                ) : (
                  <div className={styles.table} role="table" aria-label={`Projects of ${team.name}`}>
                    {team.projects.map((proj) => (
                      <div key={proj.id} className={styles.projectRow} role="row" data-testid={`team-project-${proj.name}`}>
                        <div role="cell"><p className={styles.name}>{proj.name}</p></div>
                        <div role="cell">
                          <Dropdown
                            id={`move-${proj.id}`}
                            titleText={`Move ${proj.name} to another team`}
                            hideLabel
                            label="Move to…"
                            size="sm"
                            disabled={others.length === 0}
                            items={others}
                            itemToString={(t) => t?.name ?? ''}
                            selectedItem={null}
                            onChange={({ selectedItem }) => selectedItem && p.onMoveProject(proj.id, selectedItem.id)}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}
        </>
      )}

      <Modal
        open={p.confirmDelete}
        danger
        size="sm"
        modalHeading={`Delete ${team?.name ?? 'this team'}?`}
        primaryButtonText={p.busy ? 'Deleting…' : 'Delete team'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={p.busy || (team?.projects.length ?? 0) > 0}
        onRequestClose={p.onCancelDelete}
        onRequestSubmit={p.onDelete}
      >
        <p className={styles.confirm}>
          {(team?.projects.length ?? 0) > 0
            ? 'This team still has projects. Move them to another team first.'
            : 'The team goes, and its people stay in the workspace (and in their other teams).'}
        </p>
      </Modal>
    </div>
  )
}
