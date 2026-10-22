import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors.js'
import type { AuthService, AuthUser } from './auth.js'
import type { Db, Env } from './db.js'

export type RequestContext = {
  /** True when the request carried no token and is acting as the read-only demo viewer. */
  anonymous: boolean
  userId: string
  workspaceId: string
  role: 'owner' | 'editor' | 'viewer'
  email: string
  displayName: string
  workspaceName: string
  /** How this request was let in: a signed-in session, the access token, open editing, or the read-only demo viewer. */
  via: 'session' | 'token' | 'open' | 'anonymous'
}

declare module 'hono' {
  interface ContextVariableMap {
    ctx: RequestContext
  }
}

const IDENTITY_SQL = `
  select u.id as user_id, u.email, u.display_name, w.id as workspace_id, w.name as workspace_name, m.role
  from core.workspaces w
  join core.memberships m on m.workspace_id = w.id
  join core.users u on u.id = m.user_id
  where w.slug = $1 and lower(u.email) = lower($2)`

// Sets userId and workspaceId for every request that needs them. In order:
//   1. A request with a Bearer header is checked against DEV_TOKEN: the right token acts as the demo owner, a wrong
//      one is always refused. (A break-glass path that goes away once sign-in is the only way in.)
//   2. A request with a sign-in session cookie is that person: their invitation (a core.users row with a membership)
//      gives the role. A first sign-in links the invitation to the account by verified email. No invitation: 403
//      not_invited.
//   3. OPEN_EDITING=true: no token needed, acting as the demo owner.
//   4. Sign-in is configured (BETTER_AUTH_*, GOOGLE_*): everyone else is refused with 401 unauthenticated, except that with
//      PUBLIC_VIEW=true a visitor with no session can read (GET and HEAD on 'read' routes) as the read-only demo viewer.
//   5. Otherwise (before sign-in exists): with DEV_TOKEN set, 'read' routes answer GET and HEAD as the read-only demo
//      viewer and 'strict' routes refuse; with it unset, production refuses everything and anywhere else is open as the
//      demo owner.
export type Access = 'strict' | 'read'

const MEMBER_SQL = `
  select u.id as user_id, u.email, u.display_name, u.auth_subject, w.id as workspace_id, w.name as workspace_name, m.role
  from core.workspaces w
  join core.memberships m on m.workspace_id = w.id
  join core.users u on u.id = m.user_id
  where w.slug = $1 and (u.auth_subject = $2 or (u.auth_subject is null and lower(u.email) = lower($3)))`

// The invitation behind a signed-in person. The first time, it is linked to their account (by verified email), and their
// name and picture are filled in from Google.
async function memberFor(db: Db, slug: string, who: AuthUser): Promise<RequestContext> {
  if (!who.emailVerified) throw new ApiError(403, 'email_unverified', 'Your email address is not verified.')
  const { rows } = await db.query(MEMBER_SQL, [slug, who.id, who.email])
  const row = rows[0]
  if (!row) throw new ApiError(403, 'not_invited', `${who.email} has not been invited to this workspace.`)
  let displayName: string = row.display_name
  if (!row.auth_subject) {
    displayName = who.name || row.display_name
    await db.query(`update core.users set auth_subject = $2, display_name = $3, avatar_url = coalesce($4, avatar_url) where id = $1 and auth_subject is null`, [row.user_id, who.id, displayName, who.image])
  }
  return {
    anonymous: false, via: 'session', userId: row.user_id, workspaceId: row.workspace_id, role: row.role, email: row.email, displayName, workspaceName: row.workspace_name,
  }
}

export function requestContext(deps: { env: Env; getDb: () => Db; auth?: AuthService }, access: Access = 'strict'): MiddlewareHandler {
  const cache = new Map<string, { at: number; value: RequestContext }>()
  return async (c, next) => {
    const { env, auth } = deps
    const slug = env.DEMO_WORKSPACE_SLUG || 'higherwave-demo'
    const token = env.DEV_TOKEN
    const bearer = c.req.header('authorization')
    const openEditing = env.OPEN_EDITING === 'true'

    // 2. A signed-in person (only when no Bearer header was sent).
    if (!bearer && auth) {
      const who = await auth.user(c.req.raw.headers)
      if (who) {
        c.set('ctx', await memberFor(deps.getDb(), slug, who))
        return next()
      }
    }

    // 1, 3, 4, 5: the demo identity, or a refusal.
    let anonymous = false
    let via: RequestContext['via'] = 'token'
    if (bearer && token) {
      if (bearer !== `Bearer ${token}`) throw new ApiError(401, 'unauthorized', 'Missing or invalid token.')
    } else if (openEditing) {
      via = 'open'
    } else if (auth) {
      if (env.PUBLIC_VIEW === 'true' && access === 'read' && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
        anonymous = true
        via = 'anonymous'
      } else {
        throw new ApiError(401, 'unauthenticated', 'Sign in to continue.')
      }
    } else if (token) {
      if (access === 'read' && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
        anonymous = true
        via = 'anonymous'
      } else {
        throw new ApiError(401, 'unauthorized', 'Missing or invalid token.')
      }
    } else if (env.VERCEL_ENV === 'production') {
      throw new ApiError(401, 'auth_not_configured', 'Sign-in is not set up yet, and this deployment has no DEV_TOKEN.')
    } else {
      via = 'open'
    }

    const email = env.DEV_USER_EMAIL || 'david@demo.signalflow.example'
    const key = `${slug}|${email}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < 60_000) {
      c.set('ctx', { ...hit.value, anonymous, via, role: anonymous ? 'viewer' : hit.value.role })
      return next()
    }
    const { rows } = await deps.getDb().query(IDENTITY_SQL, [slug, email])
    const row = rows[0]
    if (!row) throw new ApiError(503, 'workspace_not_found', `Workspace "${slug}" or user "${email}" not found. Run the demo seed.`)
    const value: RequestContext = {
      anonymous: false, via, userId: row.user_id, workspaceId: row.workspace_id, role: row.role, email: row.email, displayName: row.display_name, workspaceName: row.workspace_name,
    }
    cache.set(key, { at: Date.now(), value })
    c.set('ctx', { ...value, anonymous, via, role: anonymous ? 'viewer' : value.role })
    return next()
  }
}
