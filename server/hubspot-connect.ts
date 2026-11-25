// Connecting HubSpot from inside the app: an owner pastes a read-only service key, it is TRIED against HubSpot first (a wrong key or a missing permission is refused, nothing stored), then
// encrypted with the deployment's own SETTINGS_ENCRYPTION_KEY and kept in core.workspace_integrations, exactly as the command-line tool stores it. The key is never sent back, never logged
// and never shown again; replacing it or disconnecting is the only way to change it. Connecting, replacing and disconnecting are recorded in the audit log without the key.
import type { RequestContext } from './context.js'
import type { Db } from './db.js'
import { insertMany } from './sql.js'
import { cleanPortalId, makeHubspot, type HubspotFetch } from './hubspot.js'
import { sealSecret } from '../shared/secret-box.mjs'

export class BadHubspotKey extends Error {}
export class NoEncryptionKey extends Error {}

const KEY_SHAPE = /^[A-Za-z0-9._-]{20,300}$/

/** Tries the key, then stores it sealed. Throws BadHubspotKey (a malformed key or account number), HubspotError (HubSpot refused it) or NoEncryptionKey (the server cannot store a secret). */
export async function connectHubspot(db: Db, env: Record<string, string | undefined>, ctx: RequestContext, input: { token: string; portalId?: string | null }, fetchImpl?: HubspotFetch): Promise<{ portalId: string | null }> {
  const token = input.token.trim()
  if (!KEY_SHAPE.test(token)) throw new BadHubspotKey('A HubSpot service key is one long token of letters, digits and dashes. Copy it whole, with nothing before or after it.')
  const typed = (input.portalId ?? '').trim()
  const portalId = typed ? cleanPortalId(typed) : null
  if (typed && !portalId) throw new BadHubspotKey('The account number is digits only: the number after /contacts/ in HubSpot’s address bar. You can leave it empty.')
  // The key is tried before anything is stored.
  await makeHubspot({ token, portalId }, fetchImpl).check()
  let sealed: string
  try {
    sealed = sealSecret(env, token)
  } catch {
    throw new NoEncryptionKey('This app has no encryption key set, so it cannot store a key safely. Ask whoever runs Signal Flow to set SETTINGS_ENCRYPTION_KEY.')
  }
  await db.transaction(async (tx) => {
    const had = (await tx.query(`select 1 from core.workspace_integrations where workspace_id = $1 and kind = 'hubspot'`, [ctx.workspaceId])).rows.length > 0
    await tx.query(
      `insert into core.workspace_integrations (workspace_id, kind, config, secret_enc) values ($1, 'hubspot', $2::jsonb, $3)
       on conflict (workspace_id, kind) do update set config = excluded.config, secret_enc = excluded.secret_enc, updated_at = now()`,
      [ctx.workspaceId, JSON.stringify(portalId ? { portalId } : {}), sealed],
    )
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.workspace_integrations', entity_id: null, verb: had ? 'replaced key' : 'connected', after: { integration: 'HubSpot' } }])
  })
  return { portalId }
}

/** Removes the stored key. Tickets already read stay, and the source stays (it says HubSpot is not connected until a key is added again). */
export async function disconnectHubspot(db: Db, ctx: RequestContext): Promise<void> {
  await db.transaction(async (tx) => {
    const gone = (await tx.query(`delete from core.workspace_integrations where workspace_id = $1 and kind = 'hubspot' returning kind`, [ctx.workspaceId])).rows.length > 0
    if (gone) await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.workspace_integrations', entity_id: null, verb: 'disconnected', after: { integration: 'HubSpot' } }])
  })
}

/** The account number kept with the connection (not a secret), for the Settings card. Null when none was given. */
export async function hubspotPortalId(db: { query: Db['query'] }, workspaceId: string): Promise<string | null> {
  const row = (await db.query(`select config from core.workspace_integrations where workspace_id = $1 and kind = 'hubspot'`, [workspaceId])).rows[0]
  return cleanPortalId(row?.config?.portalId)
}
