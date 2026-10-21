import { test } from 'node:test'
import assert from 'node:assert/strict'
import { moved, positionFor, renumber } from './board.mjs'

const board = [
  { id: 'a', status: 'todo', position: 1000 }, { id: 'b', status: 'todo', position: 2000 }, { id: 'c', status: 'todo', position: 3000 },
  { id: 'x', status: 'done', position: 1000 },
]
const order = (list, status) => list.filter((s) => s.status === status).sort((p, q) => p.position - q.position).map((s) => s.id)

test('dropping at the end of a column puts the card last, 1000 after the previous one', () => {
  assert.deepEqual(positionFor(board, 'x', 'todo', null), { position: 4000, renumber: false })
  assert.deepEqual(positionFor(board, 'a', 'in_review', null), { position: 1000, renumber: false }, 'an empty column starts at 1000')
})

test('dropping before a card takes the number halfway between it and the one above', () => {
  assert.deepEqual(positionFor(board, 'x', 'todo', 'b'), { position: 1500, renumber: false })
  assert.deepEqual(positionFor(board, 'x', 'todo', 'a'), { position: 500, renumber: false }, 'before the first card: halfway to zero')
})

test('a card moved within its own column ignores its old place', () => {
  assert.deepEqual(order(moved(board, 'c', 'todo', 'a'), 'todo'), ['c', 'a', 'b'])
  assert.deepEqual(order(moved(board, 'a', 'todo', null), 'todo'), ['b', 'c', 'a'])
  assert.deepEqual(order(moved(board, 'a', 'todo', 'b'), 'todo'), ['a', 'b', 'c'], 'dropping before the card it is already before changes nothing')
})

test('a move across columns changes only that card and keeps the others in order', () => {
  const next = moved(board, 'b', 'done', 'x')
  assert.deepEqual([order(next, 'todo'), order(next, 'done')], [['a', 'c'], ['b', 'x']])
  assert.deepEqual(next.filter((s) => s.id !== 'b'), board.filter((s) => s.id !== 'b'), 'no other card was touched')
})

test('an unknown beforeId drops at the end', () => assert.equal(positionFor(board, 'x', 'todo', 'nope').position, 4000))

test('when neighbours are too close the column is renumbered and the card still lands between them', () => {
  const tight = [{ id: 'p', status: 'todo', position: 1000 }, { id: 'q', status: 'todo', position: 1000.001 }, { id: 'm', status: 'done', position: 1000 }]
  assert.equal(positionFor(tight, 'm', 'todo', 'q').renumber, true)
  assert.deepEqual(renumber(tight, 'm', 'todo'), [{ id: 'p', position: 1000 }, { id: 'q', position: 2000 }])
  assert.deepEqual(order(moved(tight, 'm', 'todo', 'q'), 'todo'), ['p', 'm', 'q'])
})

test('moving a card between the same two neighbours over and over never loses the order', () => {
  let list = [{ id: 'top', status: 'todo', position: 1000 }, { id: 'bottom', status: 'todo', position: 2000 }, { id: 'm', status: 'done', position: 1000 }]
  for (let i = 0; i < 80; i++) {
    list = moved(list, 'm', 'todo', 'bottom') // lands just above "bottom"
    list = moved(list, 'top', 'todo', 'm') // and "top" is dropped above it again
    assert.deepEqual(order(list, 'todo'), ['top', 'm', 'bottom'], `after round ${i}`)
  }
  const positions = list.filter((s) => s.status === 'todo').map((s) => s.position)
  assert.equal(new Set(positions).size, 3, 'positions stay distinct')
})
