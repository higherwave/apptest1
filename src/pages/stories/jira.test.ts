// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { labelFrom, readiness, ticketBody } from './jira.js'

const story = (over: Record<string, unknown> = {}) =>
  ({ summary: 'As a CSM, I want the timeline in the middle.', whyItMatters: 'Everyone loves it.', nextStep: 'Agree the layout.', theme: { title: 'The timeline saves time', participantCount: 3, totalParticipants: 4 }, checklist: [{ kind: 'criterion', text: 'It stays central' }, { kind: 'task', text: 'Observe a CSM' }, { kind: 'criterion', text: 'Panels sit beside it' }], ...over }) as never

test('the ticket description is the statement, the criteria only, why it matters, the next step and the evidence, with the link back', () => {
  const body = ticketBody(story(), 'https://app.example/projects/p1/stories?open=R6')
  assert.match(body, /^As a CSM, I want the timeline in the middle\.\n\nAcceptance criteria\n• It stays central\n• Panels sit beside it\n\nWhy it matters\nEveryone loves it\.\n\nNext step\nAgree the layout\.\n\nEvidence\nRaised by 3 of 4 participants \(The timeline saves time\)\. Source: https:\/\/app\.example\/projects\/p1\/stories\?open=R6$/)
  assert.ok(!body.includes('Observe a CSM'), 'a task is not an acceptance criterion')
})

test('a thin story still makes a body, and leaves out what it does not have', () => {
  assert.equal(ticketBody(story({ whyItMatters: null, nextStep: null, theme: null, checklist: [] })), 'As a CSM, I want the timeline in the middle.')
})

test('readiness says what is still thin, and a label is made from the theme', () => {
  assert.deepEqual(readiness(story()).map((r) => [r.ok, r.label]), [[true, 'Story statement'], [true, '2 acceptance criteria'], [true, 'Priority set'], [true, 'Next step defined']])
  assert.deepEqual(readiness(story({ summary: '', checklist: [], nextStep: ' ' })).map((r) => r.ok), [false, false, true, false])
  assert.equal(labelFrom('The customer timeline saves real time'), 'the-customer-timeline-saves-real-time')
  assert.equal(labelFrom(undefined), '')
})
