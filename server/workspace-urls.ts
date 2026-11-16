// The address people open to reach a workspace, for the links in emails, Slack posts and exports. With WORKSPACE_BASE_DOMAIN set, each customer's
// workspace is at <slug>.<domain> and a link must lead there, not to the one fixed sign-in address (which shows the deployment's own workspace).
// The deployment's own (home) workspace, and a deployment with no base domain, keep APP_URL or BETTER_AUTH_URL exactly as before.
import type { Env, Queryable } from './db.js'
import { fallbackSlug } from './workspace-host.js'

const homeBase = (env: Env) => (env.APP_URL || env.BETTER_AUTH_URL || '').replace(/\/$/, '')

/** The address of the workspace with this slug. Pure: no database. */
export function workspaceBaseUrl(env: Env, slug: string | null | undefined): string {
  const base = (env.WORKSPACE_BASE_DOMAIN ?? '').trim().toLowerCase().replace(/^\.+|\.+$/g, '')
  if (!base || !slug || slug === fallbackSlug(env)) return homeBase(env)
  let scheme = 'https:'
  try {
    scheme = new URL(env.BETTER_AUTH_URL ?? '').protocol
  } catch {
    /* no valid sign-in address: use https */
  }
  return `${scheme}//${slug}.${base}`
}

const slugs = new Map<string, { at: number; slug: string | null }>()

/** The address of a workspace by id. Asks the database for its slug only when there is a base domain (and remembers it for ten minutes). */
export async function baseUrlFor(db: Queryable, env: Env, workspaceId: string): Promise<string> {
  if (!(env.WORKSPACE_BASE_DOMAIN ?? '').trim()) return homeBase(env)
  const hit = slugs.get(workspaceId)
  if (hit && Date.now() - hit.at < 600_000) return workspaceBaseUrl(env, hit.slug)
  const slug = ((await db.query(`select slug from core.workspaces where id = $1`, [workspaceId])).rows[0]?.slug as string | undefined) ?? null
  slugs.set(workspaceId, { at: Date.now(), slug })
  return workspaceBaseUrl(env, slug)
}
