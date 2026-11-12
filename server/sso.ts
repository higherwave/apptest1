// Company sign-in (OIDC: Okta, Entra ID, Keycloak, Google Workspace and so on) and how its groups become roles. Everything here
// is a pure function of the environment, so it is tested without a database or an identity provider.
import type { Env } from './db.js'

export type Role = 'owner' | 'editor' | 'viewer'
export type SignInOption = { id: 'google' | 'oidc'; label: string }

export const googleConfigured = (env: Env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
export const oidcConfigured = (env: Env) => !!(env.OIDC_ISSUER && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET)

/** The ways to sign in on this deployment, for the sign-in screen. The label completes "Continue with ...". */
export function signInOptions(env: Env): SignInOption[] {
  const out: SignInOption[] = []
  if (oidcConfigured(env)) out.push({ id: 'oidc', label: env.OIDC_NAME?.trim() || 'single sign-on' })
  if (googleConfigured(env)) out.push({ id: 'google', label: 'Google' })
  return out
}

export type SsoPolicy = {
  /** Where the groups are in the ID token (dotted for nested claims, for example realm_access.roles). */
  groupsClaim: string
  groups: Record<Role, string[]>
  /** The role for a signed-in person with no matching group (or, without group rules, no invitation). Never owner. */
  defaultRole: Exclude<Role, 'owner'> | null
  /** Email domains (SSO_ALLOWED_DOMAINS) whose people may be added automatically with the default role. */
  allowedDomains: string[]
  /**
   * The default role for this email address, or null. Anyone can have a Google account, so while Google sign-in is on, the default
   * role is given only to addresses at an allowed domain. With only the company's own provider, everyone it signs in is an employee.
   */
  defaultRoleFor: (email: string) => Exclude<Role, 'owner'> | null
  /** True when any SSO_*_GROUPS is set: the identity provider decides roles, and the Members page is read-only. */
  managedByGroups: boolean
  /**
   * SSO_TEAM_GROUP_PREFIX, for example `signalflow-`: groups named `<prefix><team>-<role>` (signalflow-support-editors) put a person in that team with that
   * role at every sign-in, and take them out when the group goes. The default team is not managed this way. Null when not set.
   */
  teamGroupPrefix: string | null
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function ssoPolicy(env: Env): SsoPolicy {
  const groups = { owner: list(env.SSO_OWNER_GROUPS), editor: list(env.SSO_EDITOR_GROUPS), viewer: list(env.SSO_VIEWER_GROUPS) }
  const dr = env.SSO_DEFAULT_ROLE?.trim().toLowerCase()
  const defaultRole = dr === 'viewer' || dr === 'editor' ? dr : null
  const allowedDomains = list(env.SSO_ALLOWED_DOMAINS).map((d) => d.replace(/^@/, '').toLowerCase())
  return {
    allowedDomains,
    defaultRoleFor: (email) => {
      if (!defaultRole) return null
      const domain = email.split('@').pop()?.toLowerCase() ?? ''
      return allowedDomains.includes(domain) || !googleConfigured(env) ? defaultRole : null
    },
    groupsClaim: env.OIDC_GROUPS_CLAIM?.trim() || 'groups',
    groups,
    defaultRole,
    managedByGroups: groups.owner.length + groups.editor.length + groups.viewer.length > 0,
    teamGroupPrefix: env.SSO_TEAM_GROUP_PREFIX?.trim() || null,
  }
}

/** A team's name as it appears in a group name: lower case, runs of anything but letters and digits as one hyphen ("Customer Success" is customer-success). */
export const teamSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

const ROLE_WORD: Record<string, Role> = { owner: 'owner', owners: 'owner', editor: 'editor', editors: 'editor', viewer: 'viewer', viewers: 'viewer' }
const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 }

/**
 * The roles a person's groups give in each team, by team slug (the highest wins where several groups name one team). A group counts when it starts with
 * the prefix and ends in -owner(s), -editor(s) or -viewer(s); what is between is the team. Names match without regard to case.
 */
export function teamRolesFromGroups(prefix: string | null, groups: string[]): Map<string, Role> {
  const out = new Map<string, Role>()
  if (!prefix) return out
  const lead = prefix.toLowerCase()
  for (const g of groups) {
    const name = g.trim().toLowerCase()
    if (!name.startsWith(lead)) continue
    const m = /^(.+)-([a-z]+)$/.exec(name.slice(lead.length))
    const role = m ? ROLE_WORD[m[2]] : undefined
    if (!m || !role) continue
    const slug = teamSlug(m[1])
    if (!slug) continue
    if (!out.has(slug) || RANK[role] > RANK[out.get(slug)!]) out.set(slug, role)
  }
  return out
}

/** The group names in a token's claims: an array, or one string (some providers send a single group that way). */
export function claimGroups(profile: Record<string, unknown>, claim: string): string[] {
  let v: unknown = profile
  for (const part of claim.split('.')) v = v && typeof v === 'object' ? (v as Record<string, unknown>)[part] : undefined
  if (typeof v === 'string') return v ? [v] : []
  return Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : []
}

/** The highest role any of the person's groups grants (owner over editor over viewer), or null. Names match without regard to case. */
export function roleFromGroups(policy: SsoPolicy, groups: string[]): Role | null {
  const have = new Set(groups.map((g) => g.toLowerCase()))
  for (const role of ['owner', 'editor', 'viewer'] as const) if (policy.groups[role].some((g) => have.has(g.toLowerCase()))) return role
  return null
}
