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

test('the date filter presets start at midnight today, or that many days back; All time has no start', async () => {
  const { sinceFor, AUDIT_RANGES } = await import('./auditText.js')
  const now = new Date(2026, 10, 16, 15, 30, 0) // 16 Nov 2026, 3:30pm where the person is
  assert.deepEqual(AUDIT_RANGES.map((r) => r.label), ['All time', 'Today', 'Last 7 days', 'Last 30 days', 'Last 90 days'])
  assert.equal(sinceFor('all', now), undefined)
  assert.equal(sinceFor('today', now), new Date(2026, 10, 16, 0, 0, 0).toISOString(), 'the start of the day, not 24 hours ago')
  assert.equal(sinceFor('7d', now), new Date(now.getTime() - 7 * 86_400_000).toISOString())
  assert.equal(sinceFor('30d', now), new Date(now.getTime() - 30 * 86_400_000).toISOString())
  assert.equal(sinceFor('90d', now), new Date(now.getTime() - 90 * 86_400_000).toISOString())
})
