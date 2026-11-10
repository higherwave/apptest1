import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stepStates } from './nav.js'

const open = (n: number) => Array.from({ length: 10 }, (_, i) => i < n)

test('a new project has only its plan open, and that is the current step', () => {
  const r = stepStates(open(1))
  assert.equal(r.mode, 'guided')
  assert.deepEqual(r.states.slice(0, 3), ['current', 'locked', 'locked'])
})

test('with transcripts added, the earlier steps are done and Transcripts is the one to work on', () => {
  const r = stepStates(open(3))
  assert.deepEqual(r.states.slice(0, 4), ['done', 'done', 'current', 'locked'])
})

test('an open step beyond the current one is ready (Priorities can open beside Storyboard)', () => {
  const o = open(4) // through Themes; Storyboard still locked, Priorities open
  o[5] = true
  const r = stepStates(o)
  assert.equal(r.states[3], 'current')
  assert.equal(r.states[4], 'locked')
  assert.equal(r.states[5], 'ready')
  assert.equal(r.states[6], 'locked')
})

test('when every step is open the rail is neutral: all done, no current step', () => {
  const r = stepStates(open(10))
  assert.equal(r.mode, 'after')
  assert.ok(r.states.every((s) => s === 'done'))
})
