import type { Member, MemberRole } from '../../api/client'
import { T } from '../../../shared/terms.mjs'

// Pure rules the People screen uses, so they can be tested without a browser.

export const ROLE_LABEL: Record<MemberRole, string> = { owner: 'Owner', editor: 'Editor', viewer: 'Viewer' }
/** A role inside one team reads "Team owner" there; the workspace's own owner role stays "Owner". */
export const TEAM_ROLE_LABEL: Record<MemberRole, string> = { owner: 'Team owner', editor: 'Editor', viewer: 'Viewer' }
export const ROLE_HELP: Record<MemberRole, string> = {
  owner: 'Sees every team’s projects and can change admin settings.',
  editor: 'Works on launches in their own teams.',
  viewer: 'Can read launches in their own teams.',
}

export const initials = (name: string) => {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

/** The approvals of a person in a line: "Sales, Marketing · Growth, Final decision (backup)", or an empty string when there are none. */
export function approvalsLine(approvals: Member['approvals']): string {
  return approvals.map((a) => `${a.label}${a.role === 'backup' ? ` (${T.backup})` : ''}${a.teamName ? ` · ${a.teamName}` : ''}`).join(', ')
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/** What is wrong with an invitation's email, or null: the address must look like one, and the person must not be in the workspace already. */
export function emailProblem(email: string, members: { email: string }[]): string | null {
  const e = email.trim().toLowerCase()
  if (!e) return null
  if (!EMAIL.test(e)) return 'Enter a valid email address.'
  if (members.some((m) => m.email.toLowerCase() === e)) return 'This person is already in the workspace.'
  return null
}

export type TeamChoice = Record<string, MemberRole>

/** What a person's save would send: only what changed, or null when nothing did. */
export function personChange(member: Pick<Member, 'role' | 'teams'>, draft: { role: MemberRole; teams: TeamChoice }): { role?: MemberRole; teams?: TeamChoice } | null {
  const out: { role?: MemberRole; teams?: TeamChoice } = {}
  if (draft.role !== member.role) out.role = draft.role
  const was = Object.fromEntries(member.teams.map((t) => [t.teamId, t.role]))
  const ids = new Set([...Object.keys(was), ...Object.keys(draft.teams)])
  if ([...ids].some((id) => was[id] !== draft.teams[id])) out.teams = draft.teams
  return Object.keys(out).length ? out : null
}
