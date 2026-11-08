import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GAP, TOP_CLEARANCE, placeCard, scrollDelta } from './placement.js'

const card = { width: 352, height: 220 }
const wide = { width: 1280, height: 800 }
const tablet = { width: 768, height: 1024 }

test('no target: the card is centered', () => {
  assert.deepEqual(placeCard(null, card, wide), { mode: 'center' })
})

test('a small target high on the screen: the card goes below it, lined up with its left edge', () => {
  const p = placeCard({ x: 300, y: 200, width: 200, height: 60 }, card, wide)
  assert.deepEqual(p, { mode: 'beside', side: 'below', x: 300, y: 200 + 60 + GAP })
})

test('a target low on the screen: the card goes above it', () => {
  const p = placeCard({ x: 300, y: 650, width: 200, height: 60 }, card, wide)
  assert.equal(p.mode === 'beside' && p.side, 'above')
})

test('a wide, tall target (below and above do not fit): the card goes to its right when there is room', () => {
  const p = placeCard({ x: 40, y: 140, width: 700, height: 600 }, card, wide)
  assert.equal(p.mode === 'beside' && p.side, 'right')
})

test('a target that fills the screen: the card docks', () => {
  assert.deepEqual(placeCard({ x: 20, y: 140, width: 1240, height: 640 }, card, wide), { mode: 'dock' })
})

test('narrow tablet portrait: a full-width target docks the card rather than covering it', () => {
  assert.deepEqual(placeCard({ x: 24, y: 300, width: 720, height: 560 }, card, tablet), { mode: 'dock' })
})

test('a placed card never overlaps the target and stays on the screen', () => {
  for (const view of [wide, tablet]) {
    for (let y = 130; y < view.height - 40; y += 97) {
      for (let x = 0; x < view.width - 100; x += 131) {
        const target = { x, y, width: 160, height: 56 }
        const p = placeCard(target, card, view)
        if (p.mode !== 'beside') continue
        assert.ok(p.x >= 16 && p.x + card.width <= view.width - 16 && p.y >= TOP_CLEARANCE && p.y + card.height <= view.height - 16, JSON.stringify([target, p]))
        const apart = p.x + card.width <= target.x || target.x + target.width <= p.x || p.y + card.height <= target.y || target.y + target.height <= p.y
        assert.ok(apart, JSON.stringify([target, p]))
      }
    }
  }
})

test('scrolling: a target hidden under the app bars is brought down to just below them', () => {
  assert.equal(scrollDelta({ x: 0, y: 40, width: 100, height: 50 }, wide, false), 40 - TOP_CLEARANCE)
})

test('scrolling: a target far down the page is brought up', () => {
  assert.equal(scrollDelta({ x: 0, y: 1500, width: 100, height: 50 }, wide, false), 1500 - TOP_CLEARANCE)
})

test('scrolling: a target already in view stays put', () => {
  assert.equal(scrollDelta({ x: 0, y: 300, width: 100, height: 50 }, wide, false), 0)
})

test('scrolling: with the card docked at the bottom, the target is lifted to just under the app bars', () => {
  assert.equal(scrollDelta({ x: 0, y: 600, width: 100, height: 50 }, wide, true), 600 - TOP_CLEARANCE)
  assert.equal(scrollDelta({ x: 0, y: 280, width: 100, height: 500 }, wide, true), 280 - TOP_CLEARANCE)
  assert.equal(scrollDelta({ x: 0, y: TOP_CLEARANCE, width: 100, height: 500 }, wide, true), 0)
})
