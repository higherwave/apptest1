// Who a Slack user is. A member asks for a one-time code in Signal Flow and enters it in Slack (/signalflow connect <code>): that is the only way a Slack
// user becomes a member, because the address on a Slack account need not match the one in Signal Flow, and a name on a screen proves nothing. The code is
// kept hashed, lasts ten minutes and works once. A member has one Slack identity and a Slack user is one member; linking again replaces the earlier link.
import { createHash, randomInt } from 'node:crypto'
import type { Db, Queryable } from './db.js'

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0, O, 1, I or L: nothing to misread
export const CODE_MINUTES = 10

const hash = (code: string) => createHash('sha256').update(normalize(code)).digest('hex')
/** What was typed or pasted, compared: upper case, nothing but letters and digits. */
export const normalize = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
const show = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`

export type SlackStatus = { connected: boolean; slackUserId: string | null }

export async function slackStatus(db: Queryable, userId: string): Promise<SlackStatus> {
  const r = (await db.query(`select slack_user_id from core.slack_links where user_id = $1`, [userId])).rows[0]
  return { connected: !!r, slackUserId: r?.slack_user_id ?? null }
}

/** A new code for this member (an earlier unused one stops working). Returned once, in the clear; only its hash is kept. */
export async function createConnectCode(db: Db, userId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: string }> {
  const raw = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
  const expires = new Date(now.getTime() + CODE_MINUTES * 60_000)
  await db.transaction(async (tx) => {
    await tx.query(`delete from core.slack_connect_codes where user_id = $1 or expires_at < $2`, [userId, now])
    await tx.query(`insert into core.slack_connect_codes (code_hash, user_id, expires_at) values ($1, $2, $3)`, [hash(raw), userId, expires])
  })
  return { code: show(raw), expiresAt: expires.toISOString() }
}

export type Connected = { userId: string; name: string; workspaceId: string }

/** Links the Slack user to whoever the code belongs to, once. Null when the code is wrong, used or expired. */
export async function redeemConnectCode(db: Db, code: string, slack: { teamId: string; userId: string }, now: Date = new Date()): Promise<Connected | null> {
  if (normalize(code).length !== 8) return null
  return db.transaction(async (tx) => {
    const row = (await tx.query(`update core.slack_connect_codes set used_at = $2 where code_hash = $1 and used_at is null and expires_at > $2 returning user_id`, [hash(code), now])).rows[0]
    if (!row) return null
    const member = (
      await tx.query(`select u.display_name, m.workspace_id from core.users u join core.memberships m on m.user_id = u.id where u.id = $1 order by m.created_at limit 1`, [row.user_id])
    ).rows[0]
    if (!member) return null
    await tx.query(`delete from core.slack_links where workspace_id = $1 and slack_team_id = $2 and slack_user_id = $3`, [member.workspace_id, slack.teamId, slack.userId])
    await tx.query(
      `insert into core.slack_links (user_id, workspace_id, slack_team_id, slack_user_id) values ($1, $2, $3, $4)
       on conflict (user_id) do update set workspace_id = excluded.workspace_id, slack_team_id = excluded.slack_team_id, slack_user_id = excluded.slack_user_id, created_at = now()`,
      [row.user_id, member.workspace_id, slack.teamId, slack.userId],
    )
    await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'core.users', $2, 'slack_connected', null, null)`, [member.workspace_id, row.user_id])
    await tx.query(`delete from core.slack_connect_codes where user_id = $1`, [row.user_id])
    return { userId: row.user_id as string, name: member.display_name as string, workspaceId: member.workspace_id as string }
  })
}

export async function disconnectSlack(db: Queryable, userId: string): Promise<void> {
  await db.query(`delete from core.slack_links where user_id = $1`, [userId])
}

/** The member a Slack user is, or null. */
export async function memberOfSlackUser(db: Queryable, slack: { teamId: string; userId: string }): Promise<{ userId: string; workspaceId: string } | null> {
  const r = (await db.query(`select user_id, workspace_id from core.slack_links where slack_team_id = $1 and slack_user_id = $2`, [slack.teamId, slack.userId])).rows[0]
  return r ? { userId: r.user_id as string, workspaceId: r.workspace_id as string } : null
}

/** Remembers a signed Slack request; false when this exact request was seen before (a replay). Old entries are cleared as it goes. */
export async function rememberRequest(db: Queryable, signature: string, now: Date = new Date()): Promise<boolean> {
  await db.query(`delete from core.slack_requests where seen_at < $1`, [new Date(now.getTime() - 3600_000)])
  return !!(await db.query(`insert into core.slack_requests (signature) values ($1) on conflict do nothing returning signature`, [signature])).rows[0]
}
