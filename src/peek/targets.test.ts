// Where the quick-reference drawer's links go, and which clicks open the drawer. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isPlainClick, peekHref } from './targets.js'

test('each target links to its full page; a project opens on its themes once analyzed, on its plan before that', () => {
  assert.equal(peekHref({ kind: 'theme', id: 'abc' }), '/insights/themes?theme=abc')
  assert.equal(peekHref({ kind: 'topic', id: 'abc' }), '/pulse/topics/abc')
  assert.equal(peekHref({ kind: 'project', id: 'abc' }), '/projects/abc/plan')
  assert.equal(peekHref({ kind: 'project', id: 'abc' }, { status: 'draft' }), '/projects/abc/plan')
  assert.equal(peekHref({ kind: 'project', id: 'abc' }, { status: 'analyzed' }), '/projects/abc/themes')
  assert.equal(peekHref({ kind: 'theme', id: 'a b/c' }), '/insights/themes?theme=a%20b%2Fc', 'an id is escaped')
})

test('only an ordinary click opens the drawer; a modified or middle click is left to the browser', () => {
  const click = (o: Partial<Parameters<typeof isPlainClick>[0]> = {}) => isPlainClick({ metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, button: 0, ...o })
  assert.equal(click(), true)
  for (const o of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) assert.equal(click(o), false, JSON.stringify(o))
})
