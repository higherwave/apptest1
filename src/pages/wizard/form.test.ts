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

// Editing an existing project -------------------------------------------------------------------------
import { formFromProject, participantsChanged, planChanged, taskFormFromProject, tasksChanged, toParticipantsRequest, toPlanRequest, toTasksRequest } from './form.js'

const detail = {
  id: 'p1', name: 'Study', color: 'cream', template: 'Usability test', status: 'analyzed', sessions: 3, themes: 9, highPriority: 6, createdAt: '2026-10-20T00:00:00Z', version: 4,
  study: { what: 'Whether it works', jtbd: { when: 'A', want: null, so: 'C' }, outcomes: ['One', 'Two'], methods: ['Card sort', 'Diary study'] },
  stages: [], participants: [{ id: 'a1', name: 'Ada', role: null, email: 'ada@example.com', sessionDate: '2026-10-06' }, { id: 'b2', name: 'Bo', role: 'PM', email: 'bo@example.com', sessionDate: null }],
  tasks: [{ id: 't1', prompt: 'Book', followUps: [{ id: 'f1', prompt: 'Why?' }] }, { id: 't2', prompt: 'Cancel', followUps: [] }],
} as const

test('a project becomes form state: nulls become empty text, and there is always an outcome row', () => {
  const f = formFromProject(detail as never)
  assert.deepEqual([f.what, f.jtbd, f.outcomes, f.participants[0]], ['Whether it works', { when: 'A', want: '', so: 'C' }, ['One', 'Two'], { id: 'a1', name: 'Ada', role: '', email: 'ada@example.com', sessionDate: '2026-10-06' }])
  assert.deepEqual(formFromProject({ ...detail, study: { ...detail.study, outcomes: [] } } as never).outcomes, [''])
})

test('an untouched form is not changed; each part notices its own edits only', () => {
  const f = formFromProject(detail as never)
  assert.equal(planChanged(f, detail as never), false)
  assert.equal(participantsChanged(f, detail as never), false)
  const renamed = { ...f, name: 'New name' }
  assert.deepEqual([planChanged(renamed, detail as never), participantsChanged(renamed, detail as never)], [true, false])
  const moved = { ...f, participants: [f.participants[1], f.participants[0]] }
  assert.deepEqual([planChanged(moved, detail as never), participantsChanged(moved, detail as never)], [false, true], 'reordering participants is a change')
})

test('whitespace, blank outcomes, an empty extra row and method order are not changes', () => {
  const f = formFromProject(detail as never)
  const same = { ...f, name: ' Study ', outcomes: ['One', '', 'Two '], methods: ['Diary study', 'Card sort'], participants: [...f.participants, blankParticipant()] }
  assert.equal(planChanged(same, detail as never), false)
  assert.equal(participantsChanged(same, detail as never), false)
  assert.equal(participantsChanged({ ...f, participants: [{ ...f.participants[0], email: 'ADA@example.com' }, f.participants[1]] }, detail as never), false, 'email case is ignored')
})

test('the plan request has only plan fields; the participants request keeps ids and leaves new ones null', () => {
  const f = formFromProject(detail as never)
  assert.deepEqual(Object.keys(toPlanRequest(f)).sort(), ['jtbd', 'methods', 'name', 'outcomes', 'what'])
  const added = { ...f, participants: [...f.participants, { ...blankParticipant(), name: 'Cy', email: 'cy@example.com' }] }
  assert.deepEqual(toParticipantsRequest(added).participants.map((p) => [p.id, p.name]), [['a1', 'Ada'], ['b2', 'Bo'], [null, 'Cy']])
})

test('task list: unchanged is not dirty; blank rows are ignored; requests are trimmed', () => {
  const t = taskFormFromProject(detail as never)
  assert.deepEqual(t, [{ prompt: 'Book', followUps: ['Why?'] }, { prompt: 'Cancel', followUps: [] }])
  assert.equal(tasksChanged(t, detail as never), false)
  assert.equal(tasksChanged([...t, { prompt: '  ', followUps: ['x'] }], detail as never), false, 'a blank question is dropped, with its follow-ups')
  assert.equal(tasksChanged([{ prompt: 'Book', followUps: [] }, t[1]], detail as never), true)
  assert.deepEqual(toTasksRequest([{ prompt: ' Book ', followUps: [' Why? ', ''] }, { prompt: '', followUps: [] }]), { tasks: [{ prompt: 'Book', followUps: ['Why?'] }] })
})
