// The Trash. Deleting a project, a requirements document or a journey moves it here for 90 days; it can be put back whole, or removed for good.
//
// How it works without touching anything else in the app: the item and every row that hangs off it through cascading foreign keys is read out
// (found from the database's own catalog, so a table added later is included without anyone remembering it), stored as one JSON snapshot, and
// then deleted from the live tables exactly as it always was. Putting it back inserts the same rows with the same ids, parents before children.
// Links to things outside the snapshot that changed in the meantime are dealt with as they come up: a link that may be empty is emptied, a row
// that cannot exist without its parent is left out, and the answer says how many.
import type { Db, Queryable } from './db.js'
import { ApiError } from './errors.js'
import { assertNotHeld, trashProjectId } from './retention.js'

export type TrashKind = 'project' | 'document' | 'journey'
export const RETENTION_DAYS = 90
const ROOT: Record<TrashKind, string> = { project: 'core.projects', document: 'delivery.specs', journey: 'insights.workflows' }
const KEPT_ALIVE = new Set(['core.users', 'core.workspaces'])

type Row = Record<string, unknown>
type Edge = { child: string; parent: string; cols: string[]; refs: string[]; rule: string; nullable: boolean }

// The foreign keys of the data schemas, read once: they only change with a migration, and a migration is a new deployment.
let edgesCache: Edge[] | undefined
async function foreignKeys(db: Queryable): Promise<Edge[]> {
  if (edgesCache) return edgesCache
  const { rows } = await db.query(
    `select c.conrelid::regclass::text as child, c.confrelid::regclass::text as parent, c.confdeltype as rule,
            (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as cols,
            (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(attnum, ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.attnum) as refs,
            (select bool_and(not a.attnotnull) from unnest(c.conkey) k(attnum) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum) as nullable
       from pg_constraint c
      where c.contype = 'f' and c.connamespace::regnamespace::text in ('core', 'research', 'delivery', 'insights')`,
  )
  // Some drivers hand an array back as text ("{id}") when its element type is unusual: make sure these are real arrays whatever the driver does.
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : String(v ?? '').replace(/^\{|\}$/g, '').split(',').filter(Boolean))
  edgesCache = rows.map((r) => ({ child: String(r.child), parent: String(r.parent), cols: list(r.cols), refs: list(r.refs), rule: String(r.rule), nullable: !!r.nullable }))
  return edgesCache
}

const q = (ident: string) => ident.split('.').map((p) => `"${p.replace(/"/g, '')}"`).join('.')

/** The rows of the root and of everything that cascades from it, by table. */
async function collect(db: Queryable, root: string, rootId: string): Promise<Map<string, Map<string, Row>>> {
  const edges = (await foreignKeys(db)).filter((e) => e.rule === 'c')
  const tables = new Map<string, Map<string, Row>>()
  const rootRow = (await db.query(`select to_jsonb(t) as j from ${q(root)} t where id = $1`, [rootId])).rows[0]?.j as Row | undefined
  if (!rootRow) return tables
  tables.set(root, new Map([[JSON.stringify(rootRow), rootRow]]))
  const seen = new Map<string, number>() // edge -> how many parent rows it has already followed
  for (let again = true; again; ) {
    again = false
    for (const e of edges) {
      const parent = tables.get(e.parent)
      const key = `${e.child}|${e.cols.join(',')}`
      if (!parent || parent.size === 0 || seen.get(key) === parent.size) continue
      if (e.cols.length !== 1) throw new Error(`The Trash cannot follow a link on several columns (${key}).`)
      seen.set(key, parent.size)
      const ids = [...new Set([...parent.values()].map((r) => r[e.refs[0]]).filter((v) => v !== null && v !== undefined).map(String))]
      if (!ids.length) continue
      const found = (await db.query(`select to_jsonb(t) as j from ${q(e.child)} t where t.${q(e.cols[0])}::text = any($1::text[])`, [ids])).rows
      const mine = tables.get(e.child) ?? new Map<string, Row>()
      for (const f of found) {
        const k = JSON.stringify(f.j)
        if (!mine.has(k)) {
          mine.set(k, f.j as Row)
          again = true
        }
      }
      tables.set(e.child, mine)
    }
  }
  return tables
}

const SUMMARY: [string, string][] = [['research.participants', 'participants'], ['research.transcripts', 'transcripts'], ['research.themes', 'themes'], ['delivery.requirements', 'requirements'], ['delivery.stories', 'stories'], ['delivery.launches', 'launches']]

/**
 * Snapshots the item and what hangs off it into the Trash and deletes it from the live tables, in the caller's transaction (so a failure leaves
 * everything as it was). Returns the Trash entry's id.
 */
export async function moveToTrash(tx: Queryable, ctx: { workspaceId: string; userId: string }, kind: TrashKind, rootId: string, name: string, rootTable: string = ROOT[kind]): Promise<string> {
  const root = rootTable
  const tables = await collect(tx, root, rootId)
  if (!tables.size) throw new ApiError(404, 'not_found', 'That is already gone.')
  const payload = { version: 1, root, rootId, tables: Object.fromEntries([...tables].map(([t, rows]) => [t, [...rows.values()]])) }
  const summary = Object.fromEntries(SUMMARY.map(([t, label]) => [label, tables.get(t)?.size ?? 0]).filter(([, n]) => (n as number) > 0))
  const entry = (
    await tx.query(
      `insert into core.trash (workspace_id, kind, root_table, root_id, name, deleted_by, purge_at, summary, payload)
       values ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7), $8, $9)
       on conflict (root_table, root_id) do update set kind = excluded.kind, name = excluded.name, deleted_by = excluded.deleted_by, deleted_at = now(), purge_at = excluded.purge_at, summary = excluded.summary, payload = excluded.payload
       returning id`,
      [ctx.workspaceId, kind, root, rootId, name, ctx.userId, RETENTION_DAYS, JSON.stringify(summary), JSON.stringify(payload)],
    )
  ).rows[0].id as string
  await tx.query(`delete from ${q(root)} where id = $1`, [rootId])
  return entry
}

export type TrashItem = {
  id: string
  kind: TrashKind
  name: string
  deletedAt: string
  deletedBy: { id: string; name: string } | null
  purgeAt: string
  daysLeft: number
  summary: Record<string, number>
}
export type TrashList = { data: TrashItem[]; retentionDays: number }

type Who = { workspaceId: string; userId: string; role: string }

/** Owners see everything in the Trash; an editor sees what they deleted themselves; a viewer sees nothing. */
export async function listTrash(db: Queryable, who: Who): Promise<TrashList> {
  if (who.role !== 'owner' && who.role !== 'editor') return { data: [], retentionDays: RETENTION_DAYS }
  const { rows } = await db.query(
    `select t.id, t.kind, t.name, t.deleted_at::text as deleted_at, t.purge_at::text as purge_at, t.summary, t.deleted_by, u.display_name,
            greatest(0, ceil(extract(epoch from (t.purge_at - now())) / 86400))::int as days_left
       from core.trash t left join core.users u on u.id = t.deleted_by
      where t.workspace_id = $1 and ($2 or t.deleted_by = $3)
      order by t.deleted_at desc, t.id`,
    [who.workspaceId, who.role === 'owner', who.userId],
  )
  return {
    retentionDays: RETENTION_DAYS,
    data: rows.map((r) => ({
      id: r.id as string,
      kind: r.kind as TrashKind,
      name: r.name as string,
      deletedAt: new Date(r.deleted_at as string).toISOString(),
      deletedBy: r.deleted_by ? { id: r.deleted_by as string, name: String(r.display_name ?? '') } : null,
      purgeAt: new Date(r.purge_at as string).toISOString(),
      daysLeft: r.days_left as number,
      summary: (r.summary ?? {}) as Record<string, number>,
    })),
  }
}

async function entryFor(tx: Queryable, who: Who, id: string) {
  const e = (await tx.query(`select id, kind, name, root_table, root_id, deleted_by, payload from core.trash where id = $1 and workspace_id = $2 for update`, [id, who.workspaceId])).rows[0]
  // Not the person's to see: the same answer as for one that does not exist.
  if (!e || (who.role !== 'owner' && e.deleted_by !== who.userId)) throw new ApiError(404, 'not_found', 'That is not in the Trash.')
  return e
}

const audit = (tx: Queryable, who: Who, verb: string, e: Row, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, $3, $4, $5, $6, $7)`, [who.workspaceId, who.userId, e.root_table, e.root_id, verb, JSON.stringify({ name: e.name }), JSON.stringify(after)])

/** Parents before children, over every link inside the snapshot (a table that points at itself is inserted in one statement). */
function insertOrder(tableNames: string[], edges: Edge[]): string[] {
  const inside = new Set(tableNames)
  const needs = new Map(tableNames.map((t) => [t, new Set(edges.filter((e) => e.child === t && e.parent !== t && inside.has(e.parent)).map((e) => e.parent))]))
  const order: string[] = []
  while (order.length < tableNames.length) {
    const next = tableNames.find((t) => !order.includes(t) && [...needs.get(t)!].every((p) => order.includes(p)))
    if (!next) throw new Error('The links between these tables go round in a circle; the Trash cannot put them back.')
    order.push(next)
  }
  return order
}

export type Restored = { name: string; kind: TrashKind; leftOut: number }

/** Puts the item back with the same ids. Refuses (409) when something with that id is already there. */
export async function restoreFromTrash(db: Db, who: Who, id: string): Promise<Restored> {
  return db.transaction(async (tx) => {
    const e = await entryFor(tx, who, id)
    const payload = (typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload) as { root: string; rootId: string; tables: Record<string, Row[]> }
    const exists = (await tx.query(`select 1 from ${q(payload.root)} where id = $1`, [payload.rootId])).rows[0]
    if (exists) throw new ApiError(409, 'already_exists', 'Something with that identity is already in the workspace, so this cannot be restored over it.')
    const edges = await foreignKeys(tx)
    const names = Object.keys(payload.tables)
    let leftOut = 0
    for (const table of insertOrder(names, edges)) {
      let rows = payload.tables[table]
      if (!rows.length) continue
      // Links to things outside the snapshot: if the thing is gone, empty the link when it may be empty, else leave the row out.
      for (const link of edges.filter((x) => x.child === table && !names.includes(x.parent) && !KEPT_ALIVE.has(x.parent) && x.cols.length === 1)) {
        const col = link.cols[0]
        const wanted = [...new Set(rows.map((r) => r[col]).filter((v) => v !== null && v !== undefined).map(String))]
        if (!wanted.length) continue
        const there = new Set((await tx.query(`select ${q(link.refs[0])}::text as k from ${q(link.parent)} where ${q(link.refs[0])}::text = any($1::text[])`, [wanted])).rows.map((r) => r.k as string))
        const before = rows.length
        rows = rows.flatMap((r) => (r[col] === null || r[col] === undefined || there.has(String(r[col])) ? [r] : link.nullable ? [{ ...r, [col]: null }] : []))
        leftOut += before - rows.length
      }
      if (!rows.length) continue
      // Only the columns the snapshot has, so a column added since gets its default rather than null.
      const cols = Object.keys(rows[0]).map((c) => q(c)).join(', ')
      await tx.query(`insert into ${q(table)} (${cols}) select ${cols} from jsonb_populate_recordset(null::${q(table)}, $1::jsonb)`, [JSON.stringify(rows)])
    }
    await tx.query(`delete from core.trash where id = $1`, [id])
    await audit(tx, who, 'restored', e, { kind: e.kind, leftOut })
    return { name: e.name as string, kind: e.kind as TrashKind, leftOut }
  })
}

/** Removes one entry for good (the person asked, or its 90 days are up). */
export async function purgeFromTrash(db: Db, who: Who, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const e = await entryFor(tx, who, id)
    await assertNotHeld(tx, who.workspaceId, trashProjectId(e as { root_table: string; root_id: string; payload: unknown }))
    await tx.query(`delete from core.trash where id = $1`, [id])
    await audit(tx, who, 'deleted permanently', e, { kind: e.kind })
  })
}
