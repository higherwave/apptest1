import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceSlugFor } from './workspace-host.js'

const base = { WORKSPACE_BASE_DOMAIN: 'signalflow.example', WORKSPACE_SLUG: 'home' }

test('without a base domain, the whole deployment is one workspace', () => {
  assert.equal(workspaceSlugFor('acme.signalflow.example', { WORKSPACE_SLUG: 'home' }), 'home')
  assert.equal(workspaceSlugFor(undefined, {}), 'higherwave-demo')
})

test('a customer address chooses the workspace', () => {
  assert.equal(workspaceSlugFor('acme.signalflow.example', base), 'acme')
  assert.equal(workspaceSlugFor('Acme.SignalFlow.Example:443', base), 'acme', 'case and port do not matter')
  assert.equal(workspaceSlugFor('acme-research.signalflow.example.', base), 'acme-research', 'a trailing dot is the same address')
})

test('anything that is not exactly one customer name under the base domain falls back', () => {
  for (const host of ['signalflow.example', 'www.signalflow.example', 'api.signalflow.example', 'a.b.signalflow.example', 'acme.signalflow.example.evil.test', 'evilsignalflow.example', '-bad.signalflow.example', 'localhost:5173', '']) {
    assert.equal(workspaceSlugFor(host, base), 'home', host)
  }
})

import { readFileSync } from 'node:fs'
import { createDemoDatabase } from './test-utils.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'
import { RESERVED_SLUGS } from '../shared/reserved-slugs.mjs'

test('the names the platform keeps for itself are never a customer address, in the resolver, in workspace creation, and in the database', async () => {
  for (const name of RESERVED_SLUGS) assert.equal(workspaceSlugFor(`${name}.signalflow.example`, base), 'home', name)
  const { pglite } = await createDemoDatabase()
  for (const name of ['app', 'www', 'api', 'login']) {
    await assert.rejects(initWorkspace(pglite, { name: 'X', slug: name, owners: ['a@b.test'] }), /keeps for itself/, name)
    await assert.rejects(pglite.query(`insert into core.workspaces (name, slug) values ('X', $1)`, [name]), /workspace_slug_not_reserved/, name)
  }
  for (const bad of ['Acme', '-acme', 'acme-', 'a', 'has space', 'x'.repeat(50)]) {
    await assert.rejects(pglite.query(`insert into core.workspaces (name, slug) values ('X', $1)`, [bad]), /workspace_slug_shape|not_reserved/, bad)
  }
  assert.ok((await initWorkspace(pglite, { name: 'Fine', slug: 'fine-co', owners: ['a@b.test'] })).created)
})

test('the database’s list of reserved names is the same list the code uses', () => {
  const sql = readFileSync(new URL('../db/migrations/0052_reserved_workspace_names.sql', import.meta.url), 'utf8')
  const inDb = [...(/array\[([^\]]+)\]/.exec(sql)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])
  assert.deepEqual([...inDb].sort(), [...RESERVED_SLUGS].sort(), 'add a new reserved name in shared/reserved-slugs.mjs AND in a new migration')
})
