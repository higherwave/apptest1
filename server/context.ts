import type { MiddlewareHandler } from 'hono'
import { ApiError } from './errors.js'
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

// Sets userId and workspaceId for every request that needs them. Until real sign-in exists:
//   - A request with the right "Authorization: Bearer <DEV_TOKEN>" acts as the demo owner.
//   - A wrong token is always refused.
//   - No token: 'read' routes answer GET and HEAD as the read-only demo viewer; 'strict' routes (diagnostics,
//     and every write) refuse.
//   - DEV_TOKEN unset on a production deployment: everything refused, so an open production API cannot
//     happen by accident. Unset elsewhere (local development, tests): open, acting as the demo owner.
//   - OPEN_EDITING=true (set on purpose, for a demo shared with named people): a request with no token acts as the
//     demo owner and can write, whether or not DEV_TOKEN is set. A wrong token is still refused.
// Role checks and row-level security come later and slot in here as one guard.
export type Access = 'strict' | 'read'

export function requestContext(deps: { env: Env; getDb: () => Db }, access: Access = 'strict'): MiddlewareHandler {
  const cache = new Map<string, { at: number; value: RequestContext }>()
  return async (c, next) => {
    const { env } = deps
    const token = env.DEV_TOKEN
    const bearer = c.req.header('authorization')
    const openEditing = env.OPEN_EDITING === 'true'
    let anonymous = false
    if (token) {
      if (bearer === `Bearer ${token}`) {
        /* full access */
      } else if (!bearer && openEditing) {
        /* open editing: no token needed */
      } else if (!bearer && access === 'read' && (c.req.method === 'GET' || c.req.method === 'HEAD')) {
        anonymous = true
      } else {
        throw new ApiError(401, 'unauthorized', 'Missing or invalid token.')
      }
    } else if (env.VERCEL_ENV === 'production' && !openEditing) {
      throw new ApiError(401, 'auth_not_configured', 'Sign-in is not set up yet, and this deployment has no DEV_TOKEN.')
    }

    const slug = env.DEMO_WORKSPACE_SLUG || 'higherwave-demo'
    const email = env.DEV_USER_EMAIL || 'david@demo.signalflow.example'
    const key = `${slug}|${email}`
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < 60_000) {
      c.set('ctx', { ...hit.value, anonymous, role: anonymous ? 'viewer' : hit.value.role })
      return next()
    }
    const { rows } = await deps.getDb().query(IDENTITY_SQL, [slug, email])
    const row = rows[0]
    if (!row) throw new ApiError(503, 'workspace_not_found', `Workspace "${slug}" or user "${email}" not found. Run the demo seed.`)
    const value: RequestContext = {
      anonymous: false,
      userId: row.user_id, workspaceId: row.workspace_id, role: row.role, email: row.email, displayName: row.display_name, workspaceName: row.workspace_name,
    }
    cache.set(key, { at: Date.now(), value })
    c.set('ctx', { ...value, anonymous, role: anonymous ? 'viewer' : value.role })
    return next()
  }
}
