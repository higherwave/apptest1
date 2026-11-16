import { test } from 'node:test'
import assert from 'node:assert/strict'
import { baseUrlFor, workspaceBaseUrl } from './workspace-urls.js'
import { createDemoDatabase } from './test-utils.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'

const multi = { WORKSPACE_BASE_DOMAIN: 'signalflow.example', BETTER_AUTH_URL: 'https://app.signalflow.example', WORKSPACE_SLUG: 'home' }

test('a customer’s links lead to its own address; the home workspace and a single-address deployment keep the app address', () => {
  assert.equal(workspaceBaseUrl(multi, 'acme'), 'https://acme.signalflow.example')
  assert.equal(workspaceBaseUrl(multi, 'home'), 'https://app.signalflow.example', 'the home workspace is at the app address')
  assert.equal(workspaceBaseUrl({ ...multi, APP_URL: 'https://app.signalflow.example/' }, 'home'), 'https://app.signalflow.example', 'a trailing slash goes')
  assert.equal(workspaceBaseUrl({ BETTER_AUTH_URL: 'https://one.example' }, 'acme'), 'https://one.example', 'no base domain: one address for everyone')
  assert.equal(workspaceBaseUrl({ ...multi, BETTER_AUTH_URL: 'http://localhost:5198' }, 'acme'), 'http://acme.signalflow.example', 'the scheme follows the sign-in address')
  assert.equal(workspaceBaseUrl(multi, null), 'https://app.signalflow.example', 'unknown: the app address, never a broken one')
})

test('the address is found from the workspace id, and asks the database only when it must', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  await initWorkspace(pg, { name: 'Acme', slug: 'acme', owners: ['a@acme.test'] })
  const ids = Object.fromEntries((await pg.query<any>(`select slug, id from core.workspaces`)).rows.map((r: any) => [r.slug, r.id])) as Record<string, string>
  const env = { ...multi, WORKSPACE_SLUG: 'higherwave-demo' }
  assert.equal(await baseUrlFor(db.inWorkspace(ids.acme), env, ids.acme), 'https://acme.signalflow.example')
  assert.equal(await baseUrlFor(db.inWorkspace(ids['higherwave-demo']), env, ids['higherwave-demo']), 'https://app.signalflow.example')
  // With one address, no query is made at all.
  const explode = { query: async () => { throw new Error('should not ask') } }
  assert.equal(await baseUrlFor(explode as any, { BETTER_AUTH_URL: 'https://one.example' }, ids.acme), 'https://one.example')
})
