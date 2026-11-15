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
