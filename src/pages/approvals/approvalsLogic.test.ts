import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ApprovalPerson, ApprovalsOverview } from '../../api/client'
import { backupsFor, draftProblem, draftResult } from './approvalsLogic'

const person = (id: string, unavailable = false): ApprovalPerson => ({ userId: id, name: id, email: `${id}@x.test`, external: false, unavailable })
const cell = (teamId: string, mode: 'default' | 'custom' | 'off', approver: ApprovalPerson | null = null, backup: ApprovalPerson | null = null) => ({ teamId, mode, approver, backup, state: 'covered' as const, effective: approver })
const overview = (steps: Partial<ApprovalsOverview['steps'][number]>[]): ApprovalsOverview => ({
  steps: steps.map((s, i) => ({ key: `s${i}`, label: `S${i}`, optional: true, approver: null, backup: null, teams: [], ...s })),
  teams: [], people: [], gaps: 0,
})

test('a person can be marked away only when every step they approve has a backup in the same place who is not away', () => {
  const a = person('a'), b = person('b'), c = person('c')
  assert.deepEqual(backupsFor(overview([{ approver: a, backup: b }, { approver: a, backup: c }]), 'a').map((p) => p.userId).sort(), ['b', 'c'])
  assert.deepEqual(backupsFor(overview([{ approver: a, backup: b }, { approver: a }]), 'a'), [], 'one step without a backup is enough to refuse')
  assert.deepEqual(backupsFor(overview([{ approver: a, backup: person('b', true) }]), 'a'), [], 'a backup who is away does not count')
  assert.deepEqual(backupsFor(overview([{ approver: b }]), 'a'), [], 'a person who approves nothing has nothing to hand over')
})

test('a team’s own approver needs the team’s own backup; the workspace’s backup does not cover it', () => {
  const a = person('a'), b = person('b')
  const o = overview([{ approver: b, backup: a, teams: [cell('t1', 'custom', a, null)] }])
  assert.deepEqual(backupsFor(o, 'a'), [])
  const ok = overview([{ approver: b, backup: a, teams: [cell('t1', 'custom', a, b)] }])
  assert.deepEqual(backupsFor(ok, 'a').map((p) => p.userId), ['b'])
})

test('the panel says what a team ends up with, and refuses drafts that cannot work', () => {
  assert.deepEqual(draftResult('w', { mode: 'default', approver: '', backup: '' }, true), { kind: 'approver', userId: 'w' })
  assert.deepEqual(draftResult('', { mode: 'default', approver: '', backup: '' }, true), { kind: 'gap' })
  assert.deepEqual(draftResult('w', { mode: 'custom', approver: 't', backup: '' }, true), { kind: 'approver', userId: 't' })
  assert.deepEqual(draftResult('w', { mode: 'off', approver: '', backup: '' }, true), { kind: 'off' })
  assert.deepEqual(draftResult('w', { mode: 'off', approver: '', backup: '' }, false), { kind: 'approver', userId: 'w' }, 'the final decision is always used')
  assert.equal(draftProblem('', 'b', {}), 'Choose an approver before a backup.')
  assert.equal(draftProblem('a', 'a', {}), 'The approver and the backup must be different people.')
  assert.match(draftProblem('a', '', { t: { mode: 'custom', approver: '', backup: '' } }) ?? '', /approver for each team/)
  assert.equal(draftProblem('a', 'b', { t: { mode: 'default', approver: '', backup: '' } }), null)
})
