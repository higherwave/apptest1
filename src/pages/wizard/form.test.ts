// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTemplate, blankParticipant, emptyForm, stepForField, toRequest, validateStep, type WizardForm } from './form.js'

const template = {
  key: 'discovery' as const, name: 'Discovery interviews', description: null, what: 'How people do the job', jtbd: { when: '', want: '', so: '' },
  outcomes: ['Map of current workflow'], methods: ['Contextual interview'], tasks: [],
}
const filled = (over: Partial<WizardForm> = {}): WizardForm => ({
  ...emptyForm(), name: 'Study', participants: [{ name: 'Ada', role: 'Engineer', email: 'ada@example.com', sessionDate: '2026-11-02' }], ...over,
})

test('step 0 needs a project name', () => {
  assert.deepEqual(validateStep(emptyForm(), 0), { name: 'Enter a project name.' })
  assert.deepEqual(validateStep(filled(), 0), {})
})

test('step 1 has no required fields', () => assert.deepEqual(validateStep(emptyForm(), 1), {}))

test('step 2 needs one participant with a name and a valid email', () => {
  assert.deepEqual(validateStep(emptyForm(), 2), { 'participants.0.name': 'Add at least one participant.', 'participants.0.email': 'Enter an email address.' })
  assert.deepEqual(validateStep(filled(), 2), {})
  const bad = filled({ participants: [{ ...blankParticipant(), name: 'Ada', email: 'nope' }] })
  assert.deepEqual(validateStep(bad, 2), { 'participants.0.email': 'Enter a valid email address.' })
  const partial = filled({ participants: [{ ...blankParticipant(), role: 'Engineer' }] })
  assert.deepEqual(validateStep(partial, 2), { 'participants.0.name': 'Enter a name.', 'participants.0.email': 'Enter an email address.' })
})

test('empty extra participant rows are ignored; a filled one is checked', () => {
  const rows = filled({ participants: [{ name: 'Ada', role: '', email: 'ada@example.com', sessionDate: '' }, blankParticipant(), { ...blankParticipant(), email: 'x' }] })
  assert.deepEqual(validateStep(rows, 2), { 'participants.2.name': 'Enter a name.', 'participants.2.email': 'Enter a valid email address.' })
})

test('choosing a template fills the plan but keeps the name and participants', () => {
  const next = applyTemplate(filled({ name: 'Mine' }), template)
  assert.deepEqual([next.templateKey, next.what, next.outcomes, next.methods, next.name, next.participants.length], ['discovery', 'How people do the job', ['Map of current workflow'], ['Contextual interview'], 'Mine', 1])
  assert.deepEqual(applyTemplate(filled(), { ...template, outcomes: [] }).outcomes, [''], 'always one outcome row to type into')
})

test('toRequest trims, drops blank outcomes and rows, and nulls empty text', () => {
  const req = toRequest(filled({ name: '  Study  ', what: ' ', outcomes: ['A ', '', ' '], participants: [{ name: ' Ada ', role: '', email: ' ada@example.com ', sessionDate: '' }, blankParticipant()] }))
  assert.deepEqual(req, {
    name: 'Study', templateKey: 'usability', what: null, jtbd: { when: null, want: null, so: null }, outcomes: ['A'], methods: [],
    participants: [{ name: 'Ada', role: null, email: 'ada@example.com', sessionDate: null }],
  })
})

test('a server error for a field sends the person to the step that shows it', () => {
  assert.equal(stepForField('name'), 0)
  assert.equal(stepForField('participants.0.email'), 2)
  assert.equal(stepForField('methods.0'), 1)
  assert.equal(stepForField(undefined), 0)
})
