// A clean install: migrate an empty database, create a company's workspace, and run the app on it with no demo data.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { createApp } from './app.js'
import { pgliteDb } from './test-utils.js'
// @ts-expect-error plain ESM helper shared with the db/ tooling
import { initWorkspace, validSlug } from '../db/init-workspace.mjs'
// @ts-expect-error plain ESM helper shared with the db/ tooling
import { migrationFiles } from '../db/migrate.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

async function emptyDatabase() {
  const pg = new PGlite()
  for (const f of migrationFiles() as string[]) await pg.exec(readFileSync(new URL(`../db/migrations/${f}`, import.meta.url), 'utf8'))
  return { pg, db: pgliteDb(pg) }
}
const query = (pg: PGlite, sql: string, p: unknown[] = []) => pg.query<any>(sql, p).then((r) => r.rows)

test('slugs and required fields are checked before anything is written', async () => {
  const { pg } = await emptyDatabase()
  assert.equal(validSlug('acme'), true)
  assert.equal(validSlug('Acme Co'), false)
  assert.equal(validSlug('a'), false)
  await assert.rejects(() => initWorkspace(pg, { name: '', slug: 'acme', owners: ['a@acme.com'] }), /name is required/)
  await assert.rejects(() => initWorkspace(pg, { name: 'Acme', slug: 'Bad Slug', owners: ['a@acme.com'] }), /slug must be/)
  await assert.rejects(() => initWorkspace(pg, { name: 'Acme', slug: 'acme', owners: [] }), /owner email is required/)
  assert.equal((await query(pg, 'select count(*)::int n from core.workspaces'))[0].n, 0)
})

test('it creates the workspace, the four templates and the owners, and a second run adds nothing twice', async () => {
  const { pg } = await emptyDatabase()
  const first = await initWorkspace(pg, { name: 'Acme Research', slug: 'acme', owners: ['Pat@Acme.com', 'lee@acme.com'] })
  assert.equal(first.created, true)
  assert.equal(first.templatesAdded, 4)
  assert.deepEqual(first.owners, ['pat@acme.com', 'lee@acme.com'])
  const second = await initWorkspace(pg, { name: 'Acme Research', slug: 'acme', owners: ['pat@acme.com'] })
  assert.deepEqual([second.created, second.templatesAdded], [false, 0])
  assert.equal((await query(pg, 'select count(*)::int n from core.workspaces'))[0].n, 1)
  assert.equal((await query(pg, 'select count(*)::int n from core.templates'))[0].n, 4)
  assert.equal((await query(pg, `select count(*)::int n from core.memberships where role = 'owner'`))[0].n, 2)
  assert.equal((await query(pg, 'select count(*)::int n from core.projects'))[0].n, 0, 'no demo projects')
})

test('the app runs on the new workspace with no demo data: owner, templates, a first project, empty insights', async () => {
  const { pg, db } = await emptyDatabase()
  await initWorkspace(pg, { name: 'Acme Research', slug: 'acme', owners: ['pat@acme.com'] })
  const app = createApp({ env: { DEV_TOKEN: 's3cret', WORKSPACE_SLUG: 'acme', DEV_USER_EMAIL: 'pat@acme.com' }, getDb: () => db })
  const h = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
  const me = await (await app.request('/api/v1/me', { headers: h })).json()
  assert.deepEqual([me.role, me.workspaceName, me.email], ['owner', 'Acme Research', 'pat@acme.com'])
  const templates = await (await app.request('/api/v1/templates', { headers: h })).json()
  assert.deepEqual(templates.data.map((t: any) => t.key).sort(), ['blank', 'concept', 'discovery', 'usability'])
  assert.deepEqual((await (await app.request('/api/v1/projects', { headers: h })).json()).data, [])
  const made = await app.request('/api/v1/projects', { method: 'POST', headers: h, body: JSON.stringify({ name: 'First study', methods: ['Moderated usability test'], testItems: [{ description: 'Whether people finish setup', outcomes: [] }], participants: [{ name: 'Ada Lovelace', role: 'Engineer', email: 'ada@example.com', phone: '', sessionMinutes: 45 }] }) })
  assert.equal(made.status, 201, JSON.stringify(await made.clone().json()))
  const insights = await (await app.request('/api/v1/insights/themes', { headers: h })).json()
  assert.deepEqual([insights.themes, insights.projects, insights.mergeSuggestions], [[], [], []])
  assert.equal((await app.request('/api/v1/insights/customers', { headers: h })).status, 200)
  // The demo workspace is not there, so the old default would have failed: the setting is what points the app at the new one.
  const wrong = createApp({ env: { DEV_TOKEN: 's3cret', DEV_USER_EMAIL: 'pat@acme.com' }, getDb: () => db })
  const miss = await wrong.request('/api/v1/me', { headers: h })
  assert.equal(miss.status, 503)
  assert.match((await miss.json()).error.message, /init-workspace/)
})
