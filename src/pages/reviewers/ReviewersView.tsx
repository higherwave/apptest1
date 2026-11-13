import { Close } from '@carbon/icons-react'
import { Button, Checkbox, Dropdown, InlineNotification, Loading, Modal, RadioButton, Tag } from '@carbon/react'
import type { CoverageCell, Member, ReviewerOverview, ReviewerRole } from '../../api/client'
import styles from './ReviewersView.module.scss'

const ROLES: { key: ReviewerRole; label: string; help: string }[] = [
  { key: 'primary', label: 'Primary', help: 'Accountable for the step. One per step and team' },
  { key: 'alternate', label: 'Alternate', help: 'Can answer when the primary is away' },
]
const roleOf = (key: ReviewerRole) => ROLES.find((r) => r.key === key)!

export type ReviewersViewProps = {
  state: 'loading' | 'error' | 'ready'
  overview?: ReviewerOverview
  /** Everyone in the workspace, to pick who to set up. */
  people: Member[]
  errorText?: string
  notice?: string
  person: Member | null
  steps: string[]
  scope: 'all' | 'teams'
  teamIds: string[]
  role: ReviewerRole
  busy: boolean
  /** The "all teams" confirmation is open. */
  confirmAll: boolean
  onPerson: (m: Member | null) => void
  onToggleStep: (key: string, on: boolean) => void
  onScope: (s: 'all' | 'teams') => void
  onToggleTeam: (id: string, on: boolean) => void
  onRole: (r: ReviewerRole) => void
  onAdd: () => void
  onConfirmAll: () => void
  onCancelAll: () => void
  onRemove: (id: string) => void
}

const names = (people: { name: string }[]) => people.map((p) => p.name).join(', ')

// One cell of the coverage grid. A step the team uses with nobody covering it is a gap and says so; it is never left blank or hidden.
function Cell({ cell }: { cell: CoverageCell }) {
  if (cell.state === 'not_used') return <Tag size="sm" type="gray">Not used</Tag>
  if (cell.state === 'gap') {
    return (
      <>
        <Tag size="sm" type="red">{cell.alternate.length ? 'Only an alternate' : 'No reviewer'}</Tag>
        {cell.alternate.length > 0 && <span className={styles.alt}>Alternate: {names(cell.alternate)}</span>}
      </>
    )
  }
  return (
    <>
      <span className={styles.who}>{names(cell.primary)}</span>
      {cell.alternate.length > 0 && <span className={styles.alt}>Alternate: {names(cell.alternate)}</span>}
      {cell.scope === 'all' && <span className={styles.scope}>All teams</span>}
    </>
  )
}

// Presentational: who approves each step of a launch, set up once, and where the gaps are.
export function ReviewersView(p: ReviewersViewProps) {
  const o = p.overview
  const external = !!p.person?.external
  const canAdd = !!p.person && p.steps.length > 0 && (p.scope === 'all' || p.teamIds.length > 0) && !(external && p.scope === 'all') && !p.busy
  return (
    <div className={styles.page}>
      <p className={styles.intro}>
        Set up who approves each step of a launch once, instead of for every launch. A reviewer covers all teams, or the teams you choose. For a team, the reviewer for that team beats one for all teams. A step a team uses
        that nobody covers shows as a gap here and on its launches. Turn steps off for a team under Admin, Teams.
      </p>
      {p.errorText && <InlineNotification kind="error" lowContrast hideCloseButton title="Something went wrong" subtitle={p.errorText} />}
      {p.notice && <InlineNotification kind="success" lowContrast hideCloseButton title="Reviewer set up" subtitle={p.notice} />}
      {p.state === 'loading' && <Loading small withOverlay={false} description="Loading reviewers" />}

      {p.state === 'ready' && o && (
        <>
          <section aria-label="Coverage" data-testid="coverage">
            <h2 className={styles.heading}>Coverage</h2>
            <div className={styles.tableWrap}>
              <div className={styles.grid} role="table" aria-label="Who covers each step, by team">
                <div className={styles.gridRow} role="row">
                  <div className={styles.head} role="columnheader">Team</div>
                  {o.steps.map((s) => (
                    <div key={s.key} className={styles.head} role="columnheader">{s.label}</div>
                  ))}
                </div>
                {o.teams.map((t) => (
                  <div key={t.id} className={styles.gridRow} role="row" data-testid={`coverage-${t.name}`}>
                    <div role="rowheader" className={styles.team}>{t.name}</div>
                    {t.steps.map((c) => (
                      <div key={c.step} role="cell" className={styles.cell} data-state={c.state} data-testid={`cell-${t.name}-${c.step}`}>
                        <Cell cell={c} />
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section aria-label="Reviewers" data-testid="reviewer-list">
            <h2 className={styles.heading}>Reviewers</h2>
            {o.assignments.length === 0 ? (
              <p className={styles.note}>No one is set up yet. Add a reviewer below.</p>
            ) : (
              <div className={styles.tableWrap}>
                <div className={styles.list} role="table" aria-label="Reviewers">
                  <div className={styles.listRow} role="row">
                    {['Step', 'Teams', 'Reviewer', 'Role'].map((h) => (
                      <div key={h} className={styles.head} role="columnheader">{h}</div>
                    ))}
                    <div className={styles.head} role="columnheader"><span className={styles.srOnly}>Remove</span></div>
                  </div>
                  {o.assignments.map((a) => (
                    <div key={a.id} className={styles.listRow} role="row" data-testid={`reviewer-${a.step}-${a.email}-${a.teamName ?? 'all'}`}>
                      <div role="cell">{o.steps.find((s) => s.key === a.step)?.label ?? a.step}</div>
                      <div role="cell">{a.teamName ?? 'All teams'}</div>
                      <div role="cell">
                        <p className={styles.name}>{a.displayName}{a.external && <Tag size="sm" type="warm-gray" className={styles.tag}>External</Tag>}</p>
                        <p className={styles.email}>{a.email}</p>
                      </div>
                      <div role="cell">{roleOf(a.role).label}</div>
                      <div role="cell" className={styles.remove}>
                        <Button kind="ghost" size="lg" hasIconOnly renderIcon={Close} iconDescription={`Remove ${a.email} from ${a.step} (${a.teamName ?? 'all teams'})`} tooltipPosition="left" disabled={p.busy} onClick={() => p.onRemove(a.id)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          <section className={styles.add} aria-label="Add a reviewer" data-testid="add-reviewer">
            <h2 className={styles.heading}>Add a reviewer</h2>
            <div className={styles.addTop}>
              <Dropdown
                id="reviewer-person"
                titleText="Person"
                label="Choose a member"
                size="md"
                items={p.people}
                itemToString={(m) => (m ? `${m.displayName} · ${m.email}${m.external ? ' · external' : ''}` : '')}
                selectedItem={p.person}
                onChange={({ selectedItem }) => p.onPerson(selectedItem ?? null)}
              />
              <Dropdown
                id="reviewer-role"
                titleText="Role"
                label="Role"
                size="md"
                items={ROLES}
                itemToString={(r) => r?.label ?? ''}
                itemToElement={(r) => <span className={styles.roleItem}><span className={styles.roleName}>{r.label}</span><span className={styles.roleHelp}>{r.help}</span></span>}
                selectedItem={roleOf(p.role)}
                onChange={({ selectedItem }) => selectedItem && p.onRole(selectedItem.key)}
              />
            </div>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Steps they approve</legend>
              <div className={styles.checks}>
                {o.steps.map((s) => (
                  <Checkbox key={s.key} id={`step-${s.key}`} labelText={s.label} checked={p.steps.includes(s.key)} onChange={(_, { checked }) => p.onToggleStep(s.key, checked)} />
                ))}
              </div>
            </fieldset>
            <fieldset className={styles.fieldset}>
              <legend className={styles.legend}>Teams they cover</legend>
              <div className={styles.checks}>
                <RadioButton id="scope-all" name="reviewer-scope" labelText="All teams (including teams made later)" value="all" checked={p.scope === 'all'} disabled={external} onChange={() => p.onScope('all')} />
                <RadioButton id="scope-teams" name="reviewer-scope" labelText="Chosen teams" value="teams" checked={p.scope === 'teams'} onChange={() => p.onScope('teams')} />
              </div>
              {external && <p className={styles.note}>An external member can cover chosen teams only.</p>}
              {p.scope === 'teams' && (
                <div className={styles.checks}>
                  {o.teams.map((t) => (
                    <Checkbox key={t.id} id={`team-${t.id}`} labelText={t.name} checked={p.teamIds.includes(t.id)} onChange={(_, { checked }) => p.onToggleTeam(t.id, checked)} />
                  ))}
                </div>
              )}
            </fieldset>
            <div>
              <Button kind="primary" size="md" disabled={!canAdd} onClick={p.onAdd} data-testid="add-reviewer-button">
                Add reviewer
              </Button>
            </div>
          </section>
        </>
      )}

      <Modal
        open={p.confirmAll}
        size="sm"
        modalHeading="Cover all teams?"
        primaryButtonText={p.busy ? 'Adding…' : 'Add for all teams'}
        secondaryButtonText="Cancel"
        primaryButtonDisabled={p.busy}
        onRequestClose={p.onCancelAll}
        onRequestSubmit={p.onConfirmAll}
      >
        <p className={styles.confirm}>
          {p.person?.displayName ?? 'This person'} will see the launch screens of every team, now and in the future. They will not see research, themes or Admin.
        </p>
      </Modal>
    </div>
  )
}
