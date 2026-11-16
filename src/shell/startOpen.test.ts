import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startOpen } from './startOpen'

test('an expandable list starts closed, unless it has one row, which starts open', () => {
  assert.deepEqual([...startOpen([])], [])
  assert.deepEqual([...startOpen(['a'])], ['a'])
  assert.deepEqual([...startOpen(['a', 'b'])], [])
  assert.deepEqual([...startOpen(['a', 'b', 'c'])], [])
})
