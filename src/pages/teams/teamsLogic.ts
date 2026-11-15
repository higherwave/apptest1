import type { Member, MemberRole, SaveTeamInput, Team } from '../../api/client'

// Pure rules the Teams screen uses, so they can be tested without a browser.

/** A Slack channel as typed: no leading #, lower case, no surrounding space. */
export const normalizeChannel = (raw: string) => raw.trim().replace(/^#/, '').toLowerCase()

export function channelProblem(raw: string): string | null {
  const c = normalizeChannel(raw)
  if (!c) return null
  return /^[a-z0-9][a-z0-9_-]*$/.test(c) ? null : 'Slack channel names use lowercase letters, numbers, - and _.'
}

/** What is wrong with a team's name: it must not be empty, and no other team may have it (case does not matter). */
export function nameProblem(name: string, teams: Pick<Team, 'id' | 'name'>[], exceptId?: string): string | null {
  const n = name.trim()
  if (!n) return 'Enter a team name.'
  if (teams.some((t) => t.id !== exceptId && t.name.toLowerCase() === n.toLowerCase())) return 'A team with that name already exists.'
  return null
}

export type TeamDraft = { name: string; channel: string; members: Record<string, MemberRole>; moves: Record<string, string> }

/** What a save would send: only what changed, or null when nothing did. */
export function teamChange(team: Pick<Team, 'name' | 'slackChannel' | 'members'>, d: TeamDraft): SaveTeamInput | null {
  const out: SaveTeamInput = {}
  if (d.name.trim() !== team.name) out.name = d.name.trim()
  if (normalizeChannel(d.channel) !== (team.slackChannel ?? '')) out.slackChannel = normalizeChannel(d.channel) || null
  const was = Object.fromEntries(team.members.map((m) => [m.memberId, m.role]))
  const ids = new Set([...Object.keys(was), ...Object.keys(d.members)])
  if ([...ids].some((id) => was[id] !== d.members[id])) out.members = d.members
  const moves = Object.fromEntries(Object.entries(d.moves).filter(([, to]) => to))
  if (Object.keys(moves).length) out.moveProjects = moves
  return Object.keys(out).length ? out : null
}

/** The people who can still be added to a team: everyone in the workspace who is not in it, except external people (who join no team). */
export const addable = <M extends Pick<Member, 'id' | 'external'>>(members: M[], inTeam: Record<string, MemberRole>): M[] => members.filter((m) => !m.external && inTeam[m.id] === undefined)

/** Why a team cannot be deleted from here, or null when it can. */
export function deleteBlock(team: Pick<Team, 'isDefault' | 'projects'>): string | null {
  if (team.isDefault) return 'The default team can’t be deleted.'
  if (team.projects.length > 0) return 'Move this team’s projects before deleting it.'
  return null
}
