import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverageState, isOptionalStep, reviewersFor, stepUsed } from './launch.mjs'

const A = (userId, step, teamId, role = 'primary') => ({ userId, step, teamId, role })

test('the narrowest scope wins: a reviewer for the team beats one for all teams', () => {
  const list = [A('dana', 'legal', null), A('sam', 'legal', 'payments')]
  assert.deepEqual(reviewersFor(list, 'payments', 'legal'), { scope: 'team', primary: ['sam'], alternate: [] })
  assert.deepEqual(reviewersFor(list, 'search', 'legal'), { scope: 'all', primary: ['dana'], alternate: [] })
  assert.deepEqual(reviewersFor(list, 'search', 'sales'), { scope: null, primary: [], alternate: [] })
})

test('primaries are accountable and alternates stand in, at the winning scope only', () => {
  const list = [A('dana', 'legal', null), A('lee', 'legal', null, 'alternate'), A('sam', 'legal', 'payments'), A('kim', 'legal', 'payments', 'alternate')]
  assert.deepEqual(reviewersFor(list, 'payments', 'legal'), { scope: 'team', primary: ['sam'], alternate: ['kim'] })
  assert.deepEqual(reviewersFor(list, 'search', 'legal'), { scope: 'all', primary: ['dana'], alternate: ['lee'] })
})

test('the final decision cannot be turned off, and a step turned off is not used', () => {
  assert.equal(isOptionalStep('final_decision'), false)
  assert.equal(stepUsed(['sales', 'final_decision'], 'final_decision'), true)
  assert.equal(stepUsed(['sales'], 'sales'), false)
  assert.equal(stepUsed(['sales'], 'legal'), true)
})

test('coverage: covered, gap (nobody, or only an alternate), and not used', () => {
  const list = [A('dana', 'legal', null), A('lee', 'marketing', null, 'alternate')]
  assert.equal(coverageState(list, [], 'payments', 'legal').state, 'covered')
  assert.equal(coverageState(list, [], 'payments', 'sales').state, 'gap')
  assert.equal(coverageState(list, [], 'payments', 'marketing').state, 'gap', 'an alternate alone is not coverage')
  assert.equal(coverageState(list, ['sales'], 'payments', 'sales').state, 'not_used')
})
