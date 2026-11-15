import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeTerms, T } from './terms.mjs'

test('the product vocabulary and its capitalised and article forms', () => {
  assert.deepEqual([T.approver, T.Approver, T.approvers, T.Approvers, T.backup, T.Backup, T.backups, T.approvals, T.Approvals], ['approver', 'Approver', 'approvers', 'Approvers', 'backup', 'Backup', 'backups', 'approvals', 'Approvals'])
  assert.deepEqual([T.a('approver'), T.A('approver'), T.a('backup'), T.A('backup')], ['an approver', 'An approver', 'a backup', 'A backup'])
})

test('a changed word flows through every form, and the article follows it', () => {
  const r = makeTerms({ approver: 'reviewer', approvers: 'reviewers', approvals: 'sign-offs' })
  assert.deepEqual([r.approver, r.Approver, r.Approvers, r.Approvals], ['reviewer', 'Reviewer', 'Reviewers', 'Sign-offs'])
  assert.equal(r.a('approver'), 'a reviewer', 'an approver becomes a reviewer, not an reviewer')
  assert.equal(r.backup, 'backup', 'words left alone keep their default')
})
