// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auditDetail, describe, verbLabel } from './auditText.js'

test('a change shows the fields that differ, before and after', () => {
  assert.equal(auditDetail({ email: 'a@x.org', role: 'editor' }, { email: 'a@x.org', role: 'owner' }), 'role: editor → owner')
  assert.equal(auditDetail({ a: 1, b: 1, c: 1, d: 1 }, { a: 2, b: 2, c: 2, d: 2 }), 'a: 1 → 2 · b: 1 → 2 · c: 1 → 2 · …')
})

test('something made or removed shows its main fields, name first', () => {
  assert.equal(auditDetail(null, { into: 'X', name: 'Booking' }), 'name: Booking · into: X')
  assert.equal(auditDetail({ name: 'Old' }, null), 'name: Old')
  assert.equal(auditDetail(null, null), '')
})

test('field names read as words', () => {
  assert.equal(auditDetail(null, { project: 'P', stagesMapped: 5 }), 'project: P · stages mapped: 5')
})

test('long values are shortened and verbs read as phrases', () => {
  assert.ok(auditDetail(null, { name: 'x'.repeat(200) }).length < 100)
  assert.equal(verbLabel('analysis_run'), 'Analysis run')
  assert.deepEqual(describe({ entity: 'core.memberships', verb: 'removed', before: { email: 'a@x.org' }, after: null }), { what: 'Member · Removed', detail: 'email: a@x.org' })
})
