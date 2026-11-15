import { Button, InlineNotification, Loading, Tag } from '@carbon/react'
import type { CreateTeamInput, Member, SaveTeamInput, Team } from '../../api/client'
import { RightPanel } from '../../components/RightPanel'
import { initials } from '../people/peopleLogic'
import { TeamPanel } from './TeamPanel'
import styles from './TeamsView.module.scss'
import { T } from '../../../shared/terms.mjs'

export type TeamsViewProps = {
  state: 'loading' | 'error' | 'ready'
  teams: Team[]
  members: Member[]
  /** The people of teams other than the default come from sign-in groups. */
  groupsManage: boolean
  errorText?: string
  notice?: string
  busy: boolean
  /** The panel open: a team by id, or a new one. */
  panel: { type: 'new' } | { type: 'team'; id: string } | null
  panelError?: string
  onNew: () => void
  onOpen: (id: string) => void
  onClosePanel: () => void
  onCreate: (input: CreateTeamInput) => void
  onSave: (id: string, change: SaveTeamInput) => void
  onDelete: (id: string) => void
}

const MAX_AVATARS = 4

// Presentational: the teams of the workspace, who is in each, where its launches are announced, its projects and whether its approvals are covered. Everything is
// edited in a right-hand panel, as a draft that Save commits.
export function TeamsView(p: TeamsViewProps) {
  const openId = p.panel?.type === 'team' ? p.panel.id : undefined
  const team = openId ? p.teams.find((t) => t.id === openId) : undefined
  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <p className={styles.intro}>A team owns projects, and a person has a role in each team they belong to. Owners of the workspace see every team’s projects; everyone else sees only their own teams’. Anyone invited to the workspace starts in the default team.</p>
        </div>
        <Button kind="primary" size="md" onClick={p.onNew} data-testid="new-team">New team</Button>
      </div>
      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={p.errorText} />}
      {p.notice && <InlineNotification kind="success" lowContrast hideCloseButton title="Saved" subtitle={p.notice} data-testid="teams-notice" />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading teams" />}
      {p.state === 'ready' && (
        <div className={styles.tableWrap}>
          <div className={styles.table} role="table" aria-label="Teams" data-testid="teams-table">
            <div className={styles.row} role="row">
              <div className={`${styles.headCell} ${styles.teamCol}`} role="columnheader">Team</div>
              <div className={`${styles.headCell} ${styles.membersCol}`} role="columnheader">Members</div>
              <div className={`${styles.headCell} ${styles.slackCol}`} role="columnheader">Slack channel</div>
              <div className={`${styles.headCell} ${styles.projectsCol}`} role="columnheader">Projects</div>
              <div className={`${styles.headCell} ${styles.approvalsCol}`} role="columnheader">{T.Approvals}</div>
            </div>
            {p.teams.map((t) => (
              <div key={t.id} className={styles.row} role="row" data-testid={`team-${t.name}`} data-selected={openId === t.id ? true : undefined}>
                <div className={`${styles.cell} ${styles.teamCol}`} role="rowheader">
                  <Button kind="ghost" size="sm" className={styles.nameButton} data-testid={`open-team-${t.name}`} onClick={() => p.onOpen(t.id)}>{t.name}</Button>
                  {t.isDefault && <Tag size="sm" type="gray" className={styles.tag}>Default</Tag>}
                </div>
                <div className={`${styles.cell} ${styles.membersCol}`} role="cell">
                  <span className={styles.stack} aria-hidden="true">
                    {t.members.slice(0, MAX_AVATARS).map((m) => <span key={m.memberId} className={styles.stacked}>{initials(m.displayName || m.email)}</span>)}
                  </span>
                  <span className={styles.sub}>{t.members.length} {t.members.length === 1 ? 'person' : 'people'}</span>
                </div>
                <div className={`${styles.cell} ${styles.slackCol}`} role="cell">{t.slackChannel ? `#${t.slackChannel}` : <span className={styles.muted}>Not posting</span>}</div>
                <div className={`${styles.cell} ${styles.projectsCol}`} role="cell">{t.projects.length}</div>
                <div className={`${styles.cell} ${styles.approvalsCol}`} role="cell" data-testid={`team-approvals-${t.name}`}>
                  {t.gaps === 0 ? <span className={styles.covered}>Covered</span> : <span className={styles.gapText}>{t.gaps} {t.gaps === 1 ? 'gap' : 'gaps'}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <RightPanel open={p.panel?.type === 'new'} heading="New team" label="Teams" onClose={p.onClosePanel}>
        {p.panel?.type === 'new' && (
          <TeamPanel teams={p.teams} members={p.members} membersLocked={false} busy={p.busy} error={p.panelError} onCancel={p.onClosePanel} onSave={() => undefined} onDelete={() => undefined} onCreate={p.onCreate} />
        )}
      </RightPanel>
      <RightPanel open={!!team} heading={team?.name ?? 'Team'} label="Teams" onClose={p.onClosePanel}>
        {team && (
          <TeamPanel
            key={team.id}
            team={team}
            teams={p.teams}
            members={p.members}
            membersLocked={p.groupsManage && !team.isDefault}
            busy={p.busy}
            error={p.panelError}
            onCancel={p.onClosePanel}
            onSave={(change) => p.onSave(team.id, change)}
            onCreate={() => undefined}
            onDelete={() => p.onDelete(team.id)}
          />
        )}
      </RightPanel>
    </div>
  )
}
