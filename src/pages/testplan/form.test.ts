// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { blankParticipant, emptyForm, formFromProject, planChanged, taskFormFromProject, tasksChanged, toPlanRequest, toRequest, toTasksRequest, validate, type PlanForm } from './form.js'

const ada = { name: 'Ada', role: 'Engineer', email: 'ada@example.com', phone: '(555) 010-0000', sessionMinutes: '45' }
const filled = (over: Partial<PlanForm> = {}): PlanForm => ({ ...emptyForm(), name: 'Study', participants: [ada], ...over })

test('a test plan needs a project name', () => {
  assert.deepEqual(validate({ ...filled(), name: ' ' }), { name: 'Enter a project name.' })
  assert.deepEqual(validate(filled()), {})
})

test('the description and methods are optional', () => assert.deepEqual(validate(filled({ description: '', methods: [] })), {}))

test('it needs one participant with a name and a valid email', () => {
  assert.deepEqual(validate({ ...emptyForm(), name: 'Study' }), { 'participants.0.name': 'Add at least one participant.', 'participants.0.email': 'Enter an email address.' })
  const bad = filled({ participants: [{ ...blankParticipant(), name: 'Ada', email: 'nope' }] })
  assert.deepEqual(validate(bad), { 'participants.0.email': 'Enter a valid email address.' })
  const partial = filled({ participants: [{ ...blankParticipant(), role: 'Engineer' }] })
  assert.deepEqual(validate(partial), { 'participants.0.name': 'Enter a name.', 'participants.0.email': 'Enter an email address.' })
  const phoneOnly = filled({ participants: [{ ...blankParticipant(), phone: '555' }] })
  assert.deepEqual(validate(phoneOnly), { 'participants.0.name': 'Enter a name.', 'participants.0.email': 'Enter an email address.' }, 'a phone number alone is a started row')
})

test('empty extra participant rows are ignored; a filled one is checked', () => {
  const rows = filled({ participants: [ada, blankParticipant(), { ...blankParticipant(), email: 'x' }] })
  assert.deepEqual(validate(rows), { 'participants.2.name': 'Enter a name.', 'participants.2.email': 'Enter a valid email address.' })
})

test('toRequest trims, drops blank rows, and nulls empty text', () => {
  const req = toRequest(
    filled({
      name: '  Study  ',
      description: '  Whether first-time patients can book  ',
      methods: ['Survey'],
      participants: [{ name: ' Ada ', role: '', email: ' ada@example.com ', phone: ' ', sessionMinutes: '' }, blankParticipant()],
    }),
  )
  assert.deepEqual(req, {
    name: 'Study',
    description: 'Whether first-time patients can book',
    methods: ['Survey'],
    participants: [{ name: 'Ada', role: null, email: 'ada@example.com', phone: null, sessionMinutes: null }],
  })
})

// Editing an existing project -------------------------------------------------------------------------

const detail = {
  id: 'p1', name: 'Study', color: 'cream', template: 'Usability test', status: 'analyzed', sessions: 3, themes: 9, highPriority: 6, createdAt: '2026-10-20T00:00:00Z', version: 4,
  study: { methods: ['Survey', 'User Discussions'] },
  description: 'Whether it works',
  stages: [],
  participants: [
    { id: 'a1', name: 'Ada', role: null, email: 'ada@example.com', phone: '555', sessionMinutes: 60 },
    { id: 'b2', name: 'Bo', role: 'PM', email: 'bo@example.com', phone: null, sessionMinutes: null },
  ],
  tasks: [{ id: 't1', prompt: 'Book', areaId: 'a1', followUps: [{ id: 'f1', prompt: 'Why?' }] }, { id: 't2', prompt: 'Cancel', areaId: null, followUps: [] }],
} as const

test('a project becomes form state: nulls become empty text', () => {
  const f = formFromProject(detail as never)
  assert.equal(f.description, 'Whether it works')
  assert.deepEqual(f.participants[0], { id: 'a1', name: 'Ada', role: '', email: 'ada@example.com', phone: '555', sessionMinutes: '60' })
  assert.equal(formFromProject({ ...detail, description: null } as never).description, '', 'a project with no description gets an empty box')
})

test('an untouched form is not changed; every part of the page notices its own edits', () => {
  const f = formFromProject(detail as never)
  assert.equal(planChanged(f, detail as never), false)
  assert.equal(planChanged({ ...f, name: 'New name' }, detail as never), true)
  assert.equal(planChanged({ ...f, methods: [...f.methods, 'Usability Test'] }, detail as never), true)
  assert.equal(planChanged({ ...f, description: 'Whether it works well' }, detail as never), true)
  assert.equal(planChanged({ ...f, participants: [f.participants[1], f.participants[0]] }, detail as never), true, 'reordering participants is a change')
  assert.equal(planChanged({ ...f, participants: [{ ...f.participants[0], phone: '556' }, f.participants[1]] }, detail as never), true)
})

test('whitespace, empty extra rows and method order are not changes', () => {
  const f = formFromProject(detail as never)
  const same = {
    ...f,
    name: ' Study ',
    methods: ['User Discussions', 'Survey'],
    description: ' Whether it works ',
    participants: [...f.participants, blankParticipant()],
  }
  assert.equal(planChanged(same, detail as never), false)
  assert.equal(planChanged({ ...f, participants: [{ ...f.participants[0], email: 'ADA@example.com' }, f.participants[1]] }, detail as never), false, 'email case is ignored')
})

test('the save request carries everything on the page: participants keep ids and new ones are null', () => {
  const f = formFromProject(detail as never)
  const added = { ...f, participants: [...f.participants, { ...blankParticipant(), name: 'Cy', email: 'cy@example.com' }] }
  const req = toPlanRequest(added)
  assert.deepEqual(Object.keys(req).sort(), ['description', 'methods', 'name', 'participants'])
  assert.deepEqual(req.participants.map((p) => [p.id, p.name]), [['a1', 'Ada'], ['b2', 'Bo'], [null, 'Cy']])
  assert.equal(req.description, 'Whether it works')
  assert.equal(toPlanRequest({ ...added, description: '   ' }).description, null, 'a blank description is sent as none')
})

test('task list: unchanged is not dirty; blank rows are ignored; requests are trimmed', () => {
  const t = taskFormFromProject(detail as never)
  assert.deepEqual(t, [{ prompt: 'Book', areaId: 'a1', followUps: ['Why?'] }, { prompt: 'Cancel', areaId: null, followUps: [] }])
  assert.equal(tasksChanged(t, detail as never), false)
  assert.equal(tasksChanged([...t, { prompt: '  ', areaId: null, followUps: ['x'] }], detail as never), false, 'a blank question is dropped, with its follow-ups')
  assert.equal(tasksChanged([{ prompt: 'Book', areaId: 'a1', followUps: [] }, t[1]], detail as never), true)
  assert.equal(tasksChanged([{ ...t[0], areaId: 'a2' }, t[1]], detail as never), true, 'choosing another area is a change')
  assert.equal(tasksChanged([{ ...t[0], areaId: null }, t[1]], detail as never), true, 'so is clearing it')
  assert.deepEqual(toTasksRequest([{ prompt: ' Book ', areaId: 'a1', followUps: [' Why? ', ''] }, { prompt: '', areaId: null, followUps: [] }]), { tasks: [{ prompt: 'Book', areaId: 'a1', followUps: ['Why?'] }] })
})
