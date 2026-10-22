// Sign-in. Better Auth runs inside this API, against the same Postgres, with Google as the only way in. This file is the
// seam: the rest of the API only knows AuthService (a handler for /auth/* and "who is this request?"), so tests use a
// stand-in and never talk to Google.
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import type pg from 'pg'
import type { Env } from './db.js'

export type AuthUser = { id: string; email: string; name: string; image: string | null; emailVerified: boolean }

export type AuthService = {
  /** Serves everything under /api/v1/auth (the Google redirect, its callback, sign-out, the session). */
  handler: (request: Request) => Promise<Response>
  /** The signed-in person behind these headers (their session cookie), or null. */
  user: (headers: Headers) => Promise<AuthUser | null>
}

export const AUTH_BASE_PATH = '/api/v1/auth'

// Sign-in is on only when everything it needs is set, so a deployment without the variables behaves as before.
export function authConfigured(env: Env): boolean {
  return !!(env.BETTER_AUTH_SECRET && env.BETTER_AUTH_URL && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
}

const DAY = 60 * 60 * 24

// Table and column names: Better Auth's camelCase names mapped onto the snake_case tables in migration 0012.
const tables = {
  user: { modelName: 'auth_user', fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' } },
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
    socialProviders: { google: { clientId: env.GOOGLE_CLIENT_ID ?? '', clientSecret: env.GOOGLE_CLIENT_SECRET ?? '' } },
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
      return u ? { id: u.id, email: u.email, name: u.name, image: u.image ?? null, emailVerified: !!u.emailVerified } : null
    },
  }
}
