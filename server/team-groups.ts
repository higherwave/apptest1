// Sign-in groups to teams. With SSO_TEAM_GROUP_PREFIX set, a person's groups decide their place in every team except the default one, at each sign-in:
// a group `<prefix><team>-<role>` adds them (or changes their role) and its absence takes them out. Teams are still made in Admin > Teams; a group for a
// team that does not exist is ignored. Each change is audited, with the person as the actor.
import type { Db } from './db.js'
import { teamRolesFromGroups, teamSlug } from './sso.js'
import type { Role, TeamRoles } from './teams.js'

export async function syncTeamsFromGroups(db: Db, workspaceId: string, userId: string, prefix: string, groups: string[], current: TeamRoles): Promise<TeamRoles> {
  const wanted = teamRolesFromGroups(prefix, groups)
  const teams = (await db.query(`select id, name, is_default from core.teams where workspace_id = $1`, [workspaceId])).rows as { id: string; name: string; is_default: boolean }[]
  const next: TeamRoles = { ...current }
  const changes: { team: (typeof teams)[number]; before: Role | undefined; after: Role | undefined }[] = []
  for (const team of teams) {
    if (team.is_default) continue
    const after = wanted.get(teamSlug(team.name))
    const before = current[team.id]
    if (before === after) continue
    changes.push({ team, before, after })
  }
  if (changes.length === 0) return current
  await db.transaction(async (tx) => {
    const email = (await tx.query(`select email from core.users where id = $1`, [userId])).rows[0]?.email as string
    for (const { team, before, after } of changes) {
      if (after) {
        await tx.query(
          `insert into core.team_memberships (workspace_id, team_id, user_id, role, created_by, updated_by) values ($1, $2, $3, $4, $3, $3)
           on conflict (team_id, user_id) do update set role = excluded.role, updated_by = excluded.updated_by`,
          [workspaceId, team.id, userId, after],
        )
        next[team.id] = after
      } else {
        await tx.query(`delete from core.team_memberships where team_id = $1 and user_id = $2`, [team.id, userId])
        delete next[team.id]
      }
      await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'core.team_memberships', $3, $4, $5, $6)`, [
        workspaceId, userId, team.id, before ? (after ? 'role set by sign-in groups' : 'removed by sign-in groups') : 'added by sign-in groups',
        before ? JSON.stringify({ team: team.name, email, role: before }) : null, after ? JSON.stringify({ team: team.name, email, role: after }) : null,
      ])
    }
  })
  return next
}
