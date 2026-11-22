import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import { dismissProblems, getProblems, levelOf, problemsText, reportProblem, subscribeProblems } from './problems.js'

beforeEach(() => dismissProblems())

test('a problem is listed once with a count when it repeats, and listeners hear about each change', () => {
  let heard = 0
  const off = subscribeProblems(() => heard++)
  reportProblem('script', 'Maximum update depth exceeded', 'at Foo', 1000)
  reportProblem('script', 'Maximum update depth exceeded', 'at Foo', 2000)
  off()
  assert.equal(getProblems().length, 1)
  assert.equal(getProblems()[0].count, 2)
  assert.equal(getProblems()[0].at, 2000)
  assert.equal(heard, 2)
})

test('the bar is red when anything is a script error and yellow when there are only failed requests', () => {
  reportProblem('request', 'GET /projects answered 503')
  assert.equal(levelOf(getProblems()), 'request')
  reportProblem('script', 'x is not a function')
  assert.equal(levelOf(getProblems()), 'script')
})

test('noise that is not a problem is left out: ResizeObserver loops and aborted requests', () => {
  reportProblem('script', 'ResizeObserver loop completed with undelivered notifications.')
  reportProblem('script', 'AbortError: The user aborted a request.')
  assert.equal(getProblems().length, 0)
})

test('dismissing clears the list, and the copied text says when, what and where', () => {
  reportProblem('request', 'Sign out did not work: Invalid origin', '{"code":"INVALID_ORIGIN"}', Date.UTC(2026, 10, 22, 12, 0, 0))
  const text = problemsText(getProblems(), '/projects')
  assert.match(text, /Page: \/projects/)
  assert.match(text, /\[2026-11-22T12:00:00.000Z\] request x1: Sign out did not work: Invalid origin/)
  assert.match(text, /INVALID_ORIGIN/)
  dismissProblems()
  assert.equal(getProblems().length, 0)
})
