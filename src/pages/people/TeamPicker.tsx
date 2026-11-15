import { Checkbox, Select, SelectItem } from '@carbon/react'
import type { MemberRole, Team } from '../../api/client'
import { TEAM_ROLE_LABEL, type TeamChoice } from './peopleLogic'
import styles from './PeopleView.module.scss'

const ROLES: MemberRole[] = ['owner', 'editor', 'viewer']

// A checkbox per team, and for a team that is ticked, the person's role there. `locked` says which teams cannot be changed here (their sign-in groups decide).
export function TeamPicker({ teams, value, defaultRole, locked, idPrefix, onChange }: { teams: Pick<Team, 'id' | 'name' | 'isDefault'>[]; value: TeamChoice; defaultRole: MemberRole; locked?: (t: { id: string; isDefault: boolean }) => boolean; idPrefix: string; onChange: (next: TeamChoice) => void }) {
  return (
    <div className={styles.teamList} data-testid="team-picker">
      {teams.map((t) => {
        const on = value[t.id] !== undefined
        const fixed = !!locked?.(t)
        return (
          <div key={t.id} className={styles.teamRow}>
            <Checkbox
              id={`${idPrefix}-team-${t.id}`}
              labelText={t.isDefault ? `${t.name} (default team)` : t.name}
              checked={on}
              disabled={fixed}
              onChange={(_, { checked }) => {
                const next = { ...value }
                if (checked) next[t.id] = defaultRole
                else delete next[t.id]
                onChange(next)
              }}
            />
            {on && (
              <Select id={`${idPrefix}-role-${t.id}`} labelText={`Role in ${t.name}`} hideLabel size="sm" value={value[t.id]} disabled={fixed} onChange={(e) => onChange({ ...value, [t.id]: e.target.value as MemberRole })}>
                {ROLES.map((r) => <SelectItem key={r} value={r} text={TEAM_ROLE_LABEL[r]} />)}
              </Select>
            )}
          </div>
        )
      })}
    </div>
  )
}
