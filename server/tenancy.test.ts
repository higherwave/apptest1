// Tenancy: a person in one workspace never reads or changes anything of another. Run with: npm run test:api
//
// Two workspaces share one database. Workspace "demo" holds the seeded story; workspace "other" is a second customer.
// Everything below acts as the second customer's owner and aims at the first customer's ids:
//   - every GET answers without a single id or name from the first workspace in its body;
//   - every write is refused (no 2xx), and afterwards every row of every workspace table in the first workspace is exactly as it was.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { scopeSql } from './db.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const spec = parse(readFileSync(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'))
const TOKEN = { DEV_TOKEN: 's3cret' }
const auth = { authorization: 'Bearer s3cret', 'content-type': 'application/json', 'if-match': '1' }
const OTHER_EMAIL = 'owner@other.example.test'

// Routes whose answer is not workspace data at all (health, the caller, the scheduler, Slack signatures).
const NO_WORKSPACE_DATA = new Set(['/health', '/health/db', '/health/capture', '/sign-in-options', '/cron/digest', '/slack/interactions', '/slack/commands', '/notifications/unsubscribe'])

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows
  const first = (await q(`select id, slug, name from core.workspaces order by created_at limit 1`))[0]
  await initWorkspace(pg, { name: 'Other Customer', slug: 'other', owners: [OTHER_EMAIL] })
  const appFor = (slug: string, email?: string) => createApp({ env: { ...TOKEN, WORKSPACE_SLUG: slug, ...(email ? { DEV_USER_EMAIL: email } : {}) }, getDb: () => db })
  const other = appFor('other', OTHER_EMAIL)
  // Every table that carries a workspace id, with its primary key, and every row of the first workspace as text.
  const tables: { schema: string; name: string; key: string }[] = await q(
    `select c.table_schema as schema, c.table_name as name,
            coalesce((select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                       where i.indrelid = (c.table_schema || '.' || c.table_name)::regclass and i.indisprimary limit 1), 'id') as key
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.column_name = 'workspace_id' and c.table_schema in ('core', 'research', 'delivery', 'insights')
      order by 1, 2`,
  )
  const snapshot = async () => {
    const out: Record<string, string> = {}
    for (const t of tables) {
      const rows = await q(`select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) as h, count(*)::int as n from ${t.schema}.${t.name} x where workspace_id = $1`, [first.id])
      out[`${t.schema}.${t.name}`] = `${rows[0].n}:${rows[0].h}`
    }
    return out
  }
  // The first workspace's ids (up to two per table) and its readable names: none of these may ever show in the other workspace's answers.
  const ids = new Set<string>([first.id])
  for (const t of tables) for (const r of await q(`select ${t.key}::text as k from ${t.schema}.${t.name} where workspace_id = $1 order by 1 limit 2`, [first.id])) if (/^[0-9a-f-]{36}$/.test(r.k)) ids.add(r.k)
  const names = (await q(`select name from core.projects where workspace_id = $1`, [first.id])).map((r) => String(r.name)).concat(String(first.name))
  return { pg, db, q, first, other, tables, snapshot, ids: [...ids], names }
}

const FILL: Record<string, (ids: string[], i: number) => string> = {
  step: () => 'storyboard',
}
function fill(path: string, ids: string[], i: number) {
  return path.replace(/\{(\w+)\}/g, (_, name) => (FILL[name] ? FILL[name](ids, i) : ids[i % ids.length]))
}

test('the second customer can sign in on its own and sees none of the first customer’s data', async () => {
  const f = await fixture()
  const me = await f.other.request('/api/v1/me', { headers: auth })
  assert.equal(me.status, 200)
  assert.equal((await me.json()).email, OTHER_EMAIL)
  const projects = (await (await f.other.request('/api/v1/projects', { headers: auth })).json()).data
  assert.deepEqual(projects, [], 'a new workspace starts empty')
  const members = await (await f.other.request('/api/v1/members', { headers: auth })).json()
  assert.ok(JSON.stringify(members).includes(OTHER_EMAIL))
  assert.ok(!JSON.stringify(members).includes('demo.signalflow.example'), 'no one from the first workspace is listed')
})

test('control: the same detector finds the first workspace’s ids when its own owner asks', async () => {
  const f = await fixture()
  const own = createApp({ env: { ...TOKEN }, getDb: () => f.db })
  const forbidden = [...f.ids, ...f.names].filter((s) => s.length >= 8)
  let hits = 0
  for (const path of ['/projects', '/members', '/teams', '/specs']) {
    const res = await own.request(`/api/v1${path}`, { headers: auth })
    const body = JSON.stringify(await res.json())
    if (forbidden.some((s) => body.includes(s))) hits++
  }
  assert.ok(hits >= 3, `the detector found the first workspace in ${hits} of 4 of its own lists`)
})

test('every read in the other workspace leaves out the first workspace, whatever id it is aimed at', async () => {
  const f = await fixture()
  const leaks: string[] = []
  let sent = 0
  const forbidden = [...f.ids, ...f.names].filter((s) => s.length >= 8)
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    if (NO_WORKSPACE_DATA.has(path) || !item.get) continue
    const params = (path.match(/\{(\w+)\}/g) ?? []).length
    const tries = params === 0 ? 1 : f.ids.length
    for (let i = 0; i < tries; i++) {
      const res = await f.other.request(`/api/v1${fill(path, f.ids, i)}`, { headers: auth })
      sent++
      if (res.status >= 300) continue
      const body = res.headers.get('content-type')?.includes('json') ? JSON.stringify(await res.json()) : ''
      const hit = forbidden.find((s) => body.includes(s))
      if (hit) leaks.push(`GET ${fill(path, f.ids, i)} -> ${res.status} contains "${hit}"`)
    }
  }
  assert.deepEqual(leaks, [], `${leaks.length} read(s) leaked the first workspace`)
  assert.ok(sent > 100, `sent ${sent} requests`)
})

test('every write in the other workspace aimed at the first workspace is refused, and nothing in the first workspace changes', async () => {
  const f = await fixture()
  const before = await f.snapshot()
  const accepted: string[] = []
  let sent = 0
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    if (NO_WORKSPACE_DATA.has(path)) continue
    const params = (path.match(/\{(\w+)\}/g) ?? []).length
    if (params === 0) continue // a write with no id names nothing of the first workspace
    for (const method of ['put', 'post', 'patch', 'delete']) {
      if (!item[method]) continue
      for (let i = 0; i < f.ids.length; i++) {
        const url = `/api/v1${fill(path, f.ids, i)}`
        const res = await f.other.request(url, { method: method.toUpperCase(), headers: auth, body: method === 'delete' ? undefined : '{}' })
        sent++
        if (res.status < 300) accepted.push(`${method.toUpperCase()} ${url} -> ${res.status}`)
      }
    }
  }
  assert.deepEqual(accepted, [], `${accepted.length} write(s) were accepted`)
  assert.deepEqual(await f.snapshot(), before, 'the first workspace changed')
  assert.ok(sent > 200, `sent ${sent} requests`)
})

// Tables that do not belong to one workspace, with the reason. Everything else in the four data schemas must carry workspace_id.
const NOT_IN_ONE_WORKSPACE: Record<string, string> = {
  'core.workspaces': 'the workspaces themselves',
  'core.users': 'a person can belong to several workspaces',
  'core.plans': 'the platform’s plans, shared by every workspace; a workspace may read them and never change them',
  'core.notification_preferences': 'a person’s own choices about email, the same in every workspace they belong to',
  'core.slack_connect_codes': 'one-time codes that link a person’s Slack account, checked by the person who holds the code',
  'core.slack_requests': 'signatures of Slack requests already seen, so none runs twice; holds no workspace data',
}

test('every data table carries its workspace id, except the listed ones that belong to a person or to Slack', async () => {
  const f = await fixture()
  const rows = await f.q(
    `select t.table_schema || '.' || t.table_name as name,
            exists (select 1 from information_schema.columns c where c.table_schema = t.table_schema and c.table_name = t.table_name and c.column_name = 'workspace_id') as has
       from information_schema.tables t
      where t.table_type = 'BASE TABLE' and t.table_schema in ('core', 'research', 'delivery', 'insights')`,
  )
  const missing = rows.filter((r) => !r.has && !(r.name in NOT_IN_ONE_WORKSPACE)).map((r) => r.name)
  assert.deepEqual(missing, [], 'a new table needs a workspace id, or an entry in NOT_IN_ONE_WORKSPACE with its reason')
  const stale = Object.keys(NOT_IN_ONE_WORKSPACE).filter((n) => !rows.some((r) => r.name === n))
  assert.deepEqual(stale, [], 'listed tables that no longer exist')
  const wrong = rows.filter((r) => r.has && r.name in NOT_IN_ONE_WORKSPACE).map((r) => r.name)
  assert.deepEqual(wrong, [], 'listed as having no workspace, but it has one')
})

test('a child row takes its workspace from its parent, whatever the inserting code says', async () => {
  const f = await fixture()
  const launch = (await f.q(`select id, workspace_id from delivery.launches limit 1`))[0]
  const other = (await f.q(`select id from core.workspaces where slug = 'other'`))[0].id
  // The previous code inserts without the column: the trigger fills it.
  const a = (await f.q(`insert into delivery.launch_links (launch_id, step, title, url) values ($1, 'legal', 't', 'https://x.test') returning workspace_id`, [launch.id]))[0]
  assert.equal(a.workspace_id, launch.workspace_id)
  // Naming another workspace is overridden, so a row can never disagree with its parent.
  const b = (await f.q(`insert into delivery.launch_links (launch_id, workspace_id, step, title, url) values ($1, $2, 'legal', 't2', 'https://y.test') returning workspace_id`, [launch.id, other]))[0]
  assert.equal(b.workspace_id, launch.workspace_id)
})

test('with a base domain, the address chooses the workspace, and being in one does not let you into the other', async () => {
  const f = await fixture()
  const app = (email: string) => createApp({ env: { ...TOKEN, WORKSPACE_BASE_DOMAIN: 'signalflow.example', DEV_USER_EMAIL: email }, getDb: () => f.db })
  const at = (a: ReturnType<typeof app>, host: string) => a.request('/api/v1/me', { headers: { ...auth, host } })
  const theirs = app(OTHER_EMAIL)
  const there = await at(theirs, 'other.signalflow.example')
  assert.equal(there.status, 200)
  assert.equal((await there.json()).email, OTHER_EMAIL)
  // The same person at the first customer's address is not a member there.
  assert.notEqual((await at(theirs, `${f.first.slug}.signalflow.example`)).status, 200)
  // And the first customer's owner is not a member of the second customer's workspace.
  const mine = app('david@demo.signalflow.example')
  assert.equal((await at(mine, `${f.first.slug}.signalflow.example`)).status, 200)
  assert.notEqual((await at(mine, 'other.signalflow.example')).status, 200)
})

// The database's own lock, with the API out of the picture: what the restricted role can reach when application code is wrong.
const asRole = async (pg: any, workspaceId: string | null, run: (q: (sql: string, params?: unknown[]) => Promise<any[]>) => Promise<unknown>) => {
  await pg.transaction(async (tx: any) => {
    await tx.query(workspaceId ? scopeSql(workspaceId) : `select set_config('role', 'sf_app', true)`)
    await run(async (sql, params) => (await tx.query(sql, params)).rows)
    await tx.query('rollback').catch(() => undefined)
  }).catch((e: any) => { if (!/rollback/i.test(String(e?.message))) throw e })
}

test('row-level security: every workspace table is locked, and the policy is the same everywhere', async () => {
  const f = await fixture()
  const rows = await f.q(`select schemaname || '.' || tablename as name, count(*)::int as n from pg_policies where policyname = 'workspace_isolation' group by 1`)
  const locked = new Set(rows.map((r) => r.name))
  const enabled = new Set((await f.q(`select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relrowsecurity`)).map((r) => r.name))
  const unlocked = f.tables.map((t) => `${t.schema}.${t.name}`).filter((n) => !locked.has(n) || !enabled.has(n))
  assert.deepEqual(unlocked, [], 'a table with a workspace id and no row-level security')
})

test('row-level security: with no workspace set, the restricted role sees nothing; with one set, only that workspace', async () => {
  const f = await fixture()
  const other = (await f.q(`select id from core.workspaces where slug = 'other'`))[0].id
  const own = (await f.q(`select workspace_id, count(*)::int n from core.projects group by 1`))
  assert.ok(own.length >= 1 && own[0].n > 0, 'the first workspace has projects to protect')
  // No workspace: nothing, in every table.
  await asRole(f.pg, null, async (q) => {
    for (const t of f.tables) assert.equal((await q(`select count(*)::int n from ${t.schema}.${t.name}`))[0].n, 0, `${t.schema}.${t.name} showed rows with no workspace set`)
  })
  // The other workspace set: still none of the first workspace's rows, in any table.
  await asRole(f.pg, other, async (q) => {
    for (const t of f.tables) assert.equal((await q(`select count(*)::int n from ${t.schema}.${t.name} where workspace_id = $1`, [f.first.id]))[0].n, 0, `${t.schema}.${t.name} leaked`)
  })
  // The first workspace set: its own rows are there.
  await asRole(f.pg, f.first.id, async (q) => {
    assert.ok((await q(`select count(*)::int n from core.projects`))[0].n > 0)
  })
})

test('row-level security: a write that names another workspace is refused, and another workspace’s row cannot be changed or removed', async () => {
  const f = await fixture()
  const other = (await f.q(`select id from core.workspaces where slug = 'other'`))[0].id
  const project = (await f.q(`select id from core.projects where workspace_id = $1 limit 1`, [f.first.id]))[0].id
  await assert.rejects(
    asRole(f.pg, other, (q) => q(`insert into core.projects (workspace_id, name, kind) values ($1, 'sneaky', 'research')`, [f.first.id])),
    /row-level security/i,
  )
  await asRole(f.pg, other, async (q) => {
    assert.deepEqual(await q(`update core.projects set name = 'hijacked' where id = $1 returning id`, [project]), [], 'no row to update')
    assert.deepEqual(await q(`delete from core.projects where id = $1 returning id`, [project]), [], 'no row to delete')
  })
  assert.equal((await f.q(`select name from core.projects where id = $1`, [project]))[0].name !== 'hijacked', true)
})

test('row-level security: a workspace sees only its own members, and a person is still found or created through the function', async () => {
  const f = await fixture()
  const other = (await f.q(`select id from core.workspaces where slug = 'other'`))[0].id
  await asRole(f.pg, other, async (q) => {
    const emails = (await q(`select email from core.users`)).map((r) => r.email)
    assert.deepEqual(emails, [OTHER_EMAIL], 'only its own member')
    // A person who belongs to the first workspace is found by email (so one identity serves both), but the row itself stays hidden.
    const id = (await q(`select core.user_id_for_email('david@demo.signalflow.example', 'x') as id`))[0].id
    assert.ok(id)
    assert.deepEqual(await q(`select email from core.users where id = $1`, [id]), [])
    const fresh = (await q(`select core.user_id_for_email('Brand.New@Other.example.test', 'Brand') as id`))[0].id
    assert.ok(fresh)
  })
  // The restricted role cannot read sign-in tables.
  await assert.rejects(asRole(f.pg, other, (q) => q(`select * from public.auth_user`)), /permission denied/i)
})
