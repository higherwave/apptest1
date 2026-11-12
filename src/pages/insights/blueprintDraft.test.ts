// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addBackstage, addStage, blankDraft, fromWorkflow, isDirty, MAX_STAGES, moveStage, patchBackstage, patchStage, problems, removeBackstage, removeStage, toRequest } from './blueprintDraft.js'

const workflow = {
  id: 'w1', name: 'Patient access', description: null, version: 3, projectCount: 1,
  stages: [
    { id: 's1', position: 0, name: 'Find', good: 'Easy', signal: null, handoff: null, backstage: [{ id: 'b1', kind: 'Team', name: 'Front desk', owner: 'Clinic Ops' }] },
    { id: 's2', position: 1, name: 'Book', good: null, signal: null, handoff: null, backstage: [] },
  ],
} as never

test('a loaded workflow round-trips: ids kept, empty text sent as null, and nothing counts as changed', () => {
  const d = fromWorkflow(workflow)
  assert.equal(isDirty(d, fromWorkflow(workflow)), false)
  assert.deepEqual(toRequest(d).stages.map((s) => [s.id, s.signal, (s.backstage ?? []).map((b) => [b.id, b.owner])]), [['s1', null, [['b1', 'Clinic Ops']]], ['s2', null, []]])
})

test('stages are added, moved and removed, keeping their ids; the last stage cannot be removed', () => {
  let d = fromWorkflow(workflow)
  d = moveStage(d, d.stages[1].key, -1)
  assert.deepEqual(d.stages.map((s) => s.id), ['s2', 's1'])
  assert.equal(moveStage(d, d.stages[0].key, -1), d, 'the first stage cannot move earlier')
  d = addStage(d)
  assert.deepEqual([d.stages.length, d.stages[2].id, d.stages[2].name], [3, null, 'Stage 3'])
  d = removeStage(removeStage(d, d.stages[2].key), d.stages[0].key)
  assert.equal(removeStage(d, d.stages[0].key), d, 'a workflow keeps at least one stage')
  let many = blankDraft()
  for (let i = 0; i < 20; i++) many = addStage(many)
  assert.equal(many.stages.length, MAX_STAGES)
})

test('backstage entries are added, edited and removed within their own stage', () => {
  let d = fromWorkflow(workflow)
  const second = d.stages[1].key
  d = addBackstage(d, second, 'System')
  const entry = d.stages[1].backstage[0]
  assert.deepEqual([entry.kind, entry.id, entry.name], ['System', null, ''])
  assert.ok(problems(d).includes('Give every backstage entry a name.'))
  d = patchBackstage(d, second, entry.key, { name: 'EHR', owner: ' Clinical Systems ' })
  assert.deepEqual(problems(d), [])
  assert.deepEqual(toRequest(d).stages[1].backstage, [{ id: null, kind: 'System', name: 'EHR', owner: 'Clinical Systems' }])
  assert.equal(d.stages[0].backstage.length, 1, 'the other stage is untouched')
  assert.equal(removeBackstage(d, second, entry.key).stages[1].backstage.length, 0)
})

test('a change makes the draft dirty, and what is missing is named', () => {
  const original = fromWorkflow(workflow)
  const changed = patchStage(original, original.stages[0].key, { good: 'Quick' })
  assert.ok(isDirty(changed, original))
  const bad = patchStage({ ...original, name: 'x' }, original.stages[0].key, { name: ' ' })
  assert.deepEqual(problems(bad), ['Give the journey a name of at least 2 characters.', 'Give every stage a name.'])
})
