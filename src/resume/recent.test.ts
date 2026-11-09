import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ago } from './recent.js'
import { nextTodo } from './todo.js'

const project = (o: Record<string, unknown>) => ({ id: 'p1', name: 'Intake', status: 'draft', sessions: 0, themes: 0, highPriority: 0, measurements: 0, ...o }) as never

test('a draft with no sessions needs its plan; with sessions it needs analysing', () => {
  assert.equal(nextTodo(project({}))?.path, '/projects/p1/plan')
  assert.match(nextTodo(project({ sessions: 3 }))!.text, /Analyze the 3 sessions/)
})

test('an analyzed project with high-priority themes goes to Priorities; once measured it is done', () => {
  assert.equal(nextTodo(project({ status: 'analyzed', themes: 4, highPriority: 2 }))?.path, '/projects/p1/prio')
  assert.equal(nextTodo(project({ status: 'analyzed', themes: 4 }))?.path, '/projects/p1/themes')
  assert.equal(nextTodo(project({ status: 'analyzed', themes: 4, measurements: 1 })), null)
})

test('ago reads in plain words', () => {
  const now = 1_000_000_000
  assert.equal(ago(now - 30_000, now), 'just now')
  assert.equal(ago(now - 5 * 60_000, now), '5 minutes ago')
  assert.equal(ago(now - 3 * 3_600_000, now), '3 hours ago')
  assert.equal(ago(now - 24 * 3_600_000, now), 'yesterday')
  assert.equal(ago(now - 4 * 24 * 3_600_000, now), '4 days ago')
})
