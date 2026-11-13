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

import { answersFor, isAnswerFor, rationaleRequired, stepState } from './launch.mjs'

test('answers: a step and the final decision take different answers, and only a plain ready or go needs no reason', () => {
  assert.deepEqual(answersFor('legal').map((a) => a.key), ['ready', 'ready_with_conditions', 'changes_needed', 'not_applicable'])
  assert.deepEqual(answersFor('final_decision').map((a) => a.key), ['go', 'go_with_conditions', 'no_go'])
  assert.equal(isAnswerFor('legal', 'go'), false)
  assert.equal(isAnswerFor('final_decision', 'go'), true)
  assert.deepEqual(['ready', 'go', 'not_applicable', 'changes_needed', 'no_go'].map(rationaleRequired), [false, false, true, true, true])
})

test('step state: not used, missing (never hidden), waiting, answered, and reopened keeps the answer', () => {
  assert.equal(stepState({ used: false, hasPrimary: false, answer: null, reopened: false }), 'not_used')
  assert.equal(stepState({ used: true, hasPrimary: false, answer: null, reopened: false }), 'missing')
  assert.equal(stepState({ used: true, hasPrimary: true, answer: null, reopened: false }), 'waiting')
  assert.equal(stepState({ used: true, hasPrimary: true, answer: 'ready', reopened: false }), 'ready')
  assert.equal(stepState({ used: true, hasPrimary: true, answer: 'ready', reopened: true }), 'reopened')
  assert.equal(stepState({ used: true, hasPrimary: false, answer: 'ready', reopened: false }), 'ready', 'an answer given before the reviewer left still stands')
})
