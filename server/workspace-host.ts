// Which workspace a request is for. With WORKSPACE_BASE_DOMAIN set (say "signalflow.example"), a customer reaches its own workspace at
// "<slug>.signalflow.example"; the address chooses the workspace and the sign-in decides whether the person may be in it (a person who
// is not a member of that workspace is refused, whatever the address says). Without it, the whole deployment serves one workspace named
// by WORKSPACE_SLUG, exactly as before. Pure: no database, so it is easy to test.
import type { Env } from './db.js'

const RESERVED = new Set(['www', 'app', 'api', 'admin', 'auth', 'status', 'staff', 'mail', 'docs', 'help'])
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,39}[a-z0-9])$/

export function fallbackSlug(env: Env): string {
  return env.WORKSPACE_SLUG || env.DEMO_WORKSPACE_SLUG || 'higherwave-demo'
}

/** The workspace slug for this request: the subdomain under WORKSPACE_BASE_DOMAIN when there is one, else the deployment's own workspace. */
export function workspaceSlugFor(host: string | undefined | null, env: Env): string {
  const base = (env.WORKSPACE_BASE_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!base || !host) return fallbackSlug(env)
  const name = host.trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  if (!name.endsWith(`.${base}`)) return fallbackSlug(env)
  const sub = name.slice(0, -(base.length + 1))
  // "a.b.base" or a reserved or malformed name is not a workspace address.
  if (!SLUG.test(sub) || RESERVED.has(sub)) return fallbackSlug(env)
  return sub
}
