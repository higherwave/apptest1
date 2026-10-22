// Who can use the workspace. A member is an invitation: a core.users row (the email) plus a core.memberships row (the
// role). The person's first Google sign-in links it to their account (see context.ts). Only owners change anything.
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'

export type Role = 'owner' | 'editor' | 'viewer'
export type Member = { id: string; email: string; displayName: string; role: Role; status: 'active' | 'invited'; avatarUrl: string | null }

export class MemberNotFound extends Error {}
export class AlreadyMember extends Error {}
export class LastOwner extends Error {}

const MEMBER_SELECT = `
  select m.id, u.email, u.display_name, m.role, u.avatar_url, (u.auth_subject is not null) as active
  from core.memberships m join core.users u on u.id = m.user_id`

const toMember = (r: Record<string, any>): Member => ({
  id: r.id, email: r.email, displayName: r.display_name, role: r.role, status: r.active ? 'active' : 'invited', avatarUrl: r.avatar_url ?? null,
})

export async function listMembers(db: Queryable, workspaceId: string): Promise<Member[]> {
  const { rows } = await db.query(`${MEMBER_SELECT} where m.workspace_id = $1 order by (m.role = 'owner') desc, (m.role = 'editor') desc, lower(u.email)`, [workspaceId])
  return rows.map(toMember)
}

async function getMember(db: Queryable, workspaceId: string, id: string): Promise<Member | undefined> {
  const { rows } = await db.query(`${MEMBER_SELECT} where m.workspace_id = $1 and m.id = $2`, [workspaceId, id])
  return rows[0] ? toMember(rows[0]) : undefined
}

// Locks the workspace's owner rows for the rest of the transaction, so two owners cannot demote each other at once.
async function ownerCount(tx: Queryable, workspaceId: string): Promise<number> {
  const { rows } = await tx.query(`select id from core.memberships where workspace_id = $1 and role = 'owner' for update`, [workspaceId])
  return rows.length
}

const audit = (tx: Queryable, ctx: RequestContext, verb: string, id: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'core.memberships', $3, $4, $5, $6)`, [
    ctx.workspaceId, ctx.userId, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

export async function inviteMember(db: Db, ctx: RequestContext, input: { email: string; role: Role }): Promise<Member> {
  const email = input.email.trim().toLowerCase()
  return db.transaction(async (tx) => {
    const found = await tx.query(`select id from core.users where lower(email) = $1`, [email])
    let userId: string = found.rows[0]?.id
    if (!userId) {
      const made = await tx.query(`insert into core.users (email, display_name) values ($1, $2) returning id`, [email, email.split('@')[0]])
      userId = made.rows[0].id
    }
    const dup = await tx.query(`select id from core.memberships where workspace_id = $1 and user_id = $2`, [ctx.workspaceId, userId])
    if (dup.rows[0]) throw new AlreadyMember()
    const made = await tx.query(
      `insert into core.memberships (workspace_id, user_id, role, created_by, updated_by) values ($1, $2, $3, $4, $4) returning id`,
      [ctx.workspaceId, userId, input.role, ctx.userId],
    )
    await audit(tx, ctx, 'invited', made.rows[0].id, null, { email, role: input.role })
    return (await getMember(tx, ctx.workspaceId, made.rows[0].id))!
  })
}

export async function changeRole(db: Db, ctx: RequestContext, id: string, role: Role): Promise<Member> {
  return db.transaction(async (tx) => {
    const before = await getMember(tx, ctx.workspaceId, id)
    if (!before) throw new MemberNotFound()
    if (before.role === 'owner' && role !== 'owner' && (await ownerCount(tx, ctx.workspaceId)) <= 1) throw new LastOwner()
    await tx.query(`update core.memberships set role = $3, updated_by = $4 where workspace_id = $1 and id = $2`, [ctx.workspaceId, id, role, ctx.userId])
    await audit(tx, ctx, 'role changed', id, { email: before.email, role: before.role }, { email: before.email, role })
    return (await getMember(tx, ctx.workspaceId, id))!
  })
}

export async function removeMember(db: Db, ctx: RequestContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await getMember(tx, ctx.workspaceId, id)
    if (!before) throw new MemberNotFound()
    if (before.role === 'owner' && (await ownerCount(tx, ctx.workspaceId)) <= 1) throw new LastOwner()
    const user = (await tx.query(`select u.id, u.auth_subject from core.memberships m join core.users u on u.id = m.user_id where m.id = $1`, [id])).rows[0]
    await tx.query(`delete from core.memberships where workspace_id = $1 and id = $2`, [ctx.workspaceId, id])
    // Their open sessions end now, not when the cookie expires.
    if (user?.auth_subject) await tx.query(`delete from public.auth_session where user_id = $1`, [user.auth_subject])
    await audit(tx, ctx, 'removed', id, { email: before.email, role: before.role }, null)
  })
}
