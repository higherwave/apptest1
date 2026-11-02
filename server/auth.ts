// Sign-in. Better Auth runs inside this API, against the same Postgres. The ways in are Google and, for a company, its own
// identity provider over OpenID Connect (Okta, Entra ID, Keycloak and so on: OIDC_*). This file is the seam: the rest of the
// API only knows AuthService (a handler for /auth/* and "who is this request?"), so tests use a stand-in and never talk to
// an identity provider.
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { genericOAuth } from 'better-auth/plugins'
import type pg from 'pg'
import type { Env } from './db.js'
import { claimGroups, googleConfigured, oidcConfigured, ssoPolicy } from './sso.js'

export type AuthUser = { id: string; email: string; name: string; image: string | null; emailVerified: boolean; groups: string[] }

export type AuthService = {
  /** Serves everything under /api/v1/auth (the provider redirect, its callback, sign-out, the session). */
  handler: (request: Request) => Promise<Response>
  /** The signed-in person behind these headers (their session cookie), or null. */
  user: (headers: Headers) => Promise<AuthUser | null>
}

export const AUTH_BASE_PATH = '/api/v1/auth'

// Sign-in is on only when everything it needs is set, so a deployment without the variables behaves as before.
export function authConfigured(env: Env): boolean {
  return !!(env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL && (googleConfigured(env) || oidcConfigured(env)))
}

const DAY = 60 * 60 * 24

// Table and column names: Better Auth's camelCase names mapped onto the snake_case tables in migration 0012.
const tables = {
  user: {
    modelName: 'auth_user',
    fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
    // The groups the identity provider sent at the last sign-in (a JSON array), for SSO_*_GROUPS. (Not input: false: Better Auth would then ignore it when copying the provider's profile. Sign-up by email is off, so nobody can write it.)
    additionalFields: { groups: { type: 'string', required: false } },
  },
  session: {
    modelName: 'auth_session',
    fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at', ipAddress: 'ip_address', userAgent: 'user_agent', userId: 'user_id' },
    expiresIn: 7 * DAY,
    updateAge: DAY,
  },
  account: {
    modelName: 'auth_account',
    fields: {
      accountId: 'account_id', providerId: 'provider_id', userId: 'user_id', accessToken: 'access_token', refreshToken: 'refresh_token', idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at', refreshTokenExpiresAt: 'refresh_token_expires_at', createdAt: 'created_at', updatedAt: 'updated_at',
    },
  },
  verification: { modelName: 'auth_verification', fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' } },
} satisfies Partial<BetterAuthOptions>

/** What the app takes from the company identity provider's ID token: the account fields and the groups for role mapping. */
export function oidcProfileToUser(profile: Record<string, unknown>, env: Env) {
  const email = typeof profile.email === 'string' ? profile.email : ''
  // The company's provider is the authority on who works there, and some (Entra ID) never send email_verified. Only an
  // explicit false counts as unverified, unless OIDC_REQUIRE_VERIFIED_EMAIL asks for the claim to be true.
  const claimed = profile.emailVerified ?? profile.email_verified
  const emailVerified = env.OIDC_REQUIRE_VERIFIED_EMAIL === 'true' ? claimed === true : claimed !== false && claimed !== 'false'
  const name = (typeof profile.name === 'string' && profile.name) || [profile.given_name, profile.family_name].filter((p) => typeof p === 'string' && p).join(' ') || email.split('@')[0]
  return { name, emailVerified, groups: JSON.stringify(claimGroups(profile, ssoPolicy(env).groupsClaim)) }
}

/** The Better Auth options for this app. `extra` lets a test add what it needs (for example email and password). */
export function authOptions(env: Env, pool: pg.Pool, extra: Partial<BetterAuthOptions> = {}): BetterAuthOptions {
  return {
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    basePath: AUTH_BASE_PATH,
    database: pool,
    ...tables,
    // The address in BETTER_AUTH_URL is trusted automatically. List other addresses the app is served from (for example while
    // moving to a new domain), comma-separated, so sign-in started there is accepted too.
    trustedOrigins: (env.BETTER_AUTH_TRUSTED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean),
    socialProviders: googleConfigured(env) ? { google: { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' } } : {},
    plugins: oidcConfigured(env)
      ? [
          genericOAuth({
            config: [
              {
                providerId: 'oidc',
                name: env.OIDC_NAME?.trim() || 'single sign-on',
                clientId: env.OIDC_CLIENT_ID ?? '',
                clientSecret: env.OIDC_CLIENT_SECRET ?? '',
                discoveryUrl: `${(env.OIDC_ISSUER ?? '').replace(/\/+$/, '')}/.well-known/openid-configuration`,
                scopes: env.OIDC_SCOPES ? env.OIDC_SCOPES.split(/[\s,]+/).filter(Boolean) : ['openid', 'profile', 'email'],
                pkce: true,
                // The ID token is checked against the provider's published keys, issuer, audience and nonce; without those the
                // provider is not registered, so a misconfigured issuer fails closed instead of trusting unsigned claims.
                requireIdTokenVerification: true,
                // Name, picture and groups follow the provider at every sign-in, so a group change takes effect on the next one.
                overrideUserInfo: true,
                mapProfileToUser: (profile) => oidcProfileToUser(profile as Record<string, unknown>, env),
              },
            ],
          }),
        ]
      : [],
    ...extra,
  }
}

export function makeBetterAuth(env: Env, getPool: () => pg.Pool | undefined, extra: Partial<BetterAuthOptions> = {}): AuthService {
  let instance: ReturnType<typeof betterAuth> | undefined
  const get = () => {
    if (instance) return instance
    const pool = getPool()
    if (!pool) throw new Error('No database connection string is configured.')
    instance = betterAuth(authOptions(env, pool, extra))
    return instance
  }
  return {
    handler: (request) => get().handler(request),
    async user(headers) {
      // No cookie, no session: answer without touching the database or building the library.
      if (!/session_token/.test(headers.get('cookie') ?? '')) return null
      const result = await get().api.getSession({ headers })
      const u = result?.user
      return u ? { id: u.id, email: u.email, name: u.name, image: u.image ?? null, emailVerified: !!u.emailVerified, groups: parseGroups((u as { groups?: unknown }).groups) } : null
    },
  }
}

function parseGroups(raw: unknown): string[] {
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(v) ? v.filter((g): g is string => typeof g === 'string') : []
  } catch {
    return []
  }
}
