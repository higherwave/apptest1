import { test } from 'node:test'
import assert from 'node:assert/strict'
import { approvalsLine, emailProblem, initials, personChange } from './peopleLogic'

test('initials come from the name, or from the part of the address before the @', () => {
  assert.equal(initials('David Garrett'), 'DG')
  assert.equal(initials('sam'), 'S')
  assert.equal(initials('alex.rivera@acme.com'), 'AR')
})

test('approvals read as a line: backups say so, and a team’s own approvals name the team', () => {
  assert.equal(approvalsLine([]), '')
  assert.equal(
    approvalsLine([
      { step: 'sales', label: 'Sales', role: 'approver', teamId: null, teamName: null },
      { step: 'marketing', label: 'Marketing', role: 'approver', teamId: 't', teamName: 'Growth' },
      { step: 'final_decision', label: 'Final decision', role: 'backup', teamId: null, teamName: null },
    ]),
    'Sales, Marketing · Growth, Final decision (backup)',
  )
})

test('an invitation’s email must look like one and be new', () => {
  assert.equal(emailProblem('', []), null)
  assert.equal(emailProblem('nope', []), 'Enter a valid email address.')
  assert.equal(emailProblem('A@x.com', [{ email: 'a@x.com' }]), 'This person is already in the workspace.')
  assert.equal(emailProblem('b@x.com', [{ email: 'a@x.com' }]), null)
})

test('a save sends only what changed, and nothing when nothing did', () => {
  const m = { role: 'editor' as const, teams: [{ teamId: 'g', name: 'General', role: 'editor' as const }] }
  assert.equal(personChange(m, { role: 'editor', teams: { g: 'editor' } }), null)
  assert.deepEqual(personChange(m, { role: 'viewer', teams: { g: 'editor' } }), { role: 'viewer' })
  assert.deepEqual(personChange(m, { role: 'editor', teams: { g: 'editor', p: 'viewer' } }), { teams: { g: 'editor', p: 'viewer' } })
  assert.deepEqual(personChange(m, { role: 'editor', teams: {} }), { teams: {} })
})
