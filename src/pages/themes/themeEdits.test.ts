import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyPatch, cellKey, importanceOf, levelOf, matrixPatch, participantsLabel } from './themeEdits.js'

const theme = {
  id: 't1', title: 'Provider availability is hard to see', originalTitle: 'Provider availability is hard to see', category: 'pain_point', stagePosition: 0, suggestedStagePosition: 0,
  severity: -0.7, description: null, opportunity: null, priority: 'high', suggestedPriority: 'high', effort: 3, suggestedEffort: 3, effortNote: null, pinned: false, edited: false,
  overrideVersion: 0, participantCount: 3, totalParticipants: 3, mentionCount: 3, score: 0.79,
} as const

test('a patch changes only what it names; null goes back to the suggestion', () => {
  const a = applyPatch(theme as never, { pinned: true, stagePosition: 3 })
  assert.deepEqual([a.pinned, a.stagePosition, a.priority, a.title], [true, 3, 'high', theme.title])
  const b = applyPatch(a, { stagePosition: null })
  assert.equal(b.stagePosition, 0, 'back to the suggested stage')
})

test('renaming trims, and a blank title returns to the original', () => {
  const a = applyPatch(theme as never, { title: '  New name ' })
  assert.deepEqual([a.title, a.originalTitle], ['New name', theme.originalTitle])
  assert.equal(applyPatch(a, { title: '   ' }).title, theme.originalTitle)
  assert.equal(applyPatch(a, { title: null }).title, theme.originalTitle)
})

test('edited means importance or effort differs from the suggestion', () => {
  const a = applyPatch(theme as never, { priority: 'low' })
  assert.deepEqual([a.priority, a.edited], ['low', true])
  assert.equal(applyPatch(a, { priority: null }).edited, false)
  assert.equal(applyPatch(theme as never, { pinned: true, title: 'x', stagePosition: 2 }).edited, false, 'pins, names and stages are not importance edits')
})

test('moving on the matrix sends null for values equal to the suggestion', () => {
  assert.deepEqual(matrixPatch(theme as never, 3, 3), { priority: null, effort: null })
  assert.deepEqual(matrixPatch(theme as never, 1, 3), { priority: 'low', effort: null })
  assert.deepEqual(matrixPatch(theme as never, 2, 1), { priority: 'medium', effort: 1 })
})

test('matrix cells are importance-effort, with importance 3 for high', () => {
  assert.equal(cellKey({ priority: 'high', effort: 1 }), '3-1')
  assert.equal(cellKey({ priority: 'low', effort: 3 }), '1-3')
  assert.deepEqual([importanceOf('low'), importanceOf('high'), levelOf(2)], [1, 3, 'medium'])
})

test('participants read "N of M participants", as in the prototype', () => assert.equal(participantsLabel(theme as never), '3 of 3 participants'))
