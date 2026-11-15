import { Button, InlineNotification, Select, SelectItem, TextInput } from '@carbon/react'
import { Close } from '@carbon/icons-react'
import { useState } from 'react'
import type { CreateTeamInput, Member, MemberRole, SaveTeamInput, Team } from '../../api/client'
import { TEAM_ROLE_LABEL } from '../people/peopleLogic'
import { addable, channelProblem, deleteBlock, nameProblem, normalizeChannel, teamChange, type TeamDraft } from './teamsLogic'
import parts from '../../components/PanelParts.module.scss'
import styles from './TeamPanel.module.scss'

const ROLES: MemberRole[] = ['owner', 'editor', 'viewer']

// One team, edited as a draft: its name and Slack channel, its people (with their role in the team) and the projects to move out. A new team is the same
// panel with nothing in it yet. Nothing is saved until Save; deleting asks first and acts at once. Rendered with a key per team, so a draft never carries over.
export function TeamPanel({ team, teams, members, membersLocked, busy, error, onSave, onCreate, onCancel, onDelete }: {
  /** The team being edited; none for a new team. */
  team?: Team
  teams: Team[]
  members: Member[]
  /** The team's people come from sign-in groups, so they are not changed here. */
  membersLocked: boolean
  busy: boolean
  error?: string
  onSave: (change: SaveTeamInput) => void
  onCreate: (input: CreateTeamInput) => void
  onCancel: () => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState<TeamDraft>(() => ({ name: team?.name ?? '', channel: team?.slackChannel ?? '', members: Object.fromEntries((team?.members ?? []).map((m) => [m.memberId, m.role])), moves: {} }))
  const [confirming, setConfirming] = useState(false)
  const set = (patch: Partial<TeamDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const nameBad = nameProblem(draft.name, teams, team?.id)
  const chanBad = channelProblem(draft.channel)
  const change = team ? teamChange(team, draft) : null
  const people = Object.entries(draft.members).map(([id, role]) => ({ id, role, who: members.find((m) => m.id === id) })).filter((p) => p.who)
  const choices = addable(members, draft.members)
  const block = team ? deleteBlock(team) : null
  const valid = !nameBad && !chanBad
  const save = () => {
    if (!team) return onCreate({ name: draft.name.trim(), slackChannel: normalizeChannel(draft.channel) || null, members: draft.members })
    if (change) onSave(change)
    else onCancel()
  }
  return (
    <div className={parts.body} data-testid="team-panel" data-team={team?.name ?? 'new'}>
      <div className={parts.scroll}>
      {error && <InlineNotification kind="error" lowContrast hideCloseButton title="Not saved" subtitle={error} />}
      <section className={parts.section} aria-label="Team">
        <TextInput id="team-name" labelText="Team name" placeholder="e.g. Support" value={draft.name} invalid={!!draft.name.trim() && !!nameBad} invalidText={nameBad ?? ''} onChange={(e) => set({ name: e.target.value })} />
        <div className={styles.channel}>
          <span className={styles.hash} aria-hidden="true">#</span>
          <TextInput id="team-slack" labelText="Slack channel for launches" placeholder="launches" value={draft.channel.replace(/^#/, '')} invalid={!!chanBad} invalidText={chanBad ?? ''} maxLength={80} onChange={(e) => set({ channel: e.target.value })} />
        </div>
        <p className={parts.note}>Each launch of this team gets one thread here, with a reply when answers are asked for, a step is answered, the final decision is made or the brief reopens an answer. Leave it empty to post nothing. Invite the Signal Flow app to a private channel first.</p>
      </section>
      <section className={parts.section} aria-label="People">
        <h3 className={parts.heading}>People</h3>
        {!team && <p className={parts.note}>Optional. You can add people later.</p>}
        {membersLocked && <p className={parts.note}>People’s places in this team come from your sign-in groups. Change them in your identity provider.</p>}
        <ul className={parts.list} aria-label="People in the team">
          {people.map((p) => (
            <li key={p.id} className={parts.item} data-testid={`team-member-${p.who!.email}`}>
              <span><span className={parts.itemName}>{p.who!.displayName}</span><span className={parts.itemSub}>{p.who!.email}</span></span>
              <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription={`Remove ${p.who!.displayName} from the team`} tooltipPosition="left" disabled={membersLocked} data-testid={`remove-member-${p.who!.email}`} onClick={() => { const next = { ...draft.members }; delete next[p.id]; set({ members: next }) }} />
              <div className={parts.itemField}>
                <Select id={`role-${p.id}`} labelText={`${p.who!.displayName} role`} hideLabel size="sm" value={p.role} disabled={membersLocked} onChange={(e) => set({ members: { ...draft.members, [p.id]: e.target.value as MemberRole } })}>
                  {ROLES.map((r) => <SelectItem key={r} value={r} text={TEAM_ROLE_LABEL[r]} />)}
                </Select>
              </div>
            </li>
          ))}
        </ul>
        {choices.length > 0 ? (
          <Select id="team-add" labelText="Add someone from the workspace" size="md" value="" disabled={membersLocked} onChange={(e) => { if (e.target.value) set({ members: { ...draft.members, [e.target.value]: 'editor' } }) }}>
            <SelectItem value="" text="Add someone from the workspace…" />
            {choices.map((m) => <SelectItem key={m.id} value={m.id} text={`${m.displayName} · ${m.email}`} />)}
          </Select>
        ) : (
          <p className={parts.help}>Everyone in the workspace is in this team.</p>
        )}
      </section>
      {team && (
        <section className={parts.section} aria-label="Projects">
          <h3 className={parts.heading}>Projects</h3>
          {team.projects.length === 0 && <p className={parts.help}>This team has no projects.</p>}
          <ul className={parts.list} aria-label="Projects in the team">
            {team.projects.map((pr) => (
              <li key={pr.id} className={parts.item} data-testid={`team-project-${pr.name}`}>
                <span className={parts.itemName}>{pr.name}</span>
                <span />
                <div className={parts.itemField}>
                  <Select id={`move-${pr.id}`} labelText={`Move ${pr.name} to`} hideLabel size="sm" value={draft.moves[pr.id] ?? ''} onChange={(e) => set({ moves: { ...draft.moves, [pr.id]: e.target.value } })}>
                    <SelectItem value="" text="Move to…" />
                    {teams.filter((t) => t.id !== team.id).map((t) => <SelectItem key={t.id} value={t.id} text={t.name} />)}
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {team && (
        <section className={parts.section} aria-label="Delete">
          <h3 className={parts.heading}>Delete this team</h3>
          {block ? (
            <p className={parts.help} data-testid="delete-blocked">{block}</p>
          ) : confirming ? (
            <div className={parts.confirmBox} data-testid="delete-confirm">
              <p className={parts.help}>The team’s people stay in the workspace; they just leave this team. Its approvals go with it.</p>
              <div className={parts.confirmActions}>
                <Button kind="danger" size="sm" disabled={busy} onClick={onDelete} data-testid="confirm-delete-team">Delete</Button>
                <Button kind="ghost" size="sm" onClick={() => setConfirming(false)}>Keep</Button>
              </div>
            </div>
          ) : (
            <div><Button kind="danger--tertiary" size="sm" onClick={() => setConfirming(true)} data-testid="delete-team">Delete team</Button></div>
          )}
        </section>
      )}
      </div>
      <div className={parts.actions}>
        <Button kind="secondary" size="md" onClick={onCancel} data-testid="cancel-team">Cancel</Button>
        <Button kind="primary" size="md" disabled={!valid || !draft.name.trim() || busy} onClick={save} data-testid="save-team">{busy ? 'Saving…' : team ? 'Save' : 'Create team'}</Button>
      </div>
    </div>
  )
}
