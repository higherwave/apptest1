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
  /** True when any SSO_*_GROUPS is set: the identity provider decides roles, and the Members page is read-only. */
  managedByGroups: boolean
}

const list = (v: string | undefined) => (v ?? '').split(',').map((s) => s.trim()).filter(Boolean)

export function ssoPolicy(env: Env): SsoPolicy {
  const groups = { owner: list(env.SSO_OWNER_GROUPS), editor: list(env.SSO_EDITOR_GROUPS), viewer: list(env.SSO_VIEWER_GROUPS) }
  const dr = env.SSO_DEFAULT_ROLE?.trim().toLowerCase()
  return {
    groupsClaim: env.OIDC_GROUPS_CLAIM?.trim() || 'groups',
    groups,
    defaultRole: dr === 'viewer' || dr === 'editor' ? dr : null,
    managedByGroups: groups.owner.length + groups.editor.length + groups.viewer.length > 0,
  }
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
