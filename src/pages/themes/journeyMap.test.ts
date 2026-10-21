// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sentimentTop, stageOpportunity, stagePainPoints, stageSentiment, strongestFirst } from './journeyMap.js'

const t = (title: string, over: Record<string, unknown> = {}) =>
  ({ title, category: 'pain_point', priority: 'medium', participantCount: 1, severity: -0.5, opportunity: `Fix ${title}`, ...over }) as never

test('strongest first orders by importance, then people, and keeps the given order on a tie', () => {
  const list = [t('a'), t('b', { priority: 'high' }), t('c', { participantCount: 3 }), t('d')]
  assert.deepEqual((strongestFirst(list) as { title: string }[]).map((x) => x.title), ['b', 'c', 'a', 'd'])
})

test('a stage has one opportunity, the strongest theme’s; an empty stage has none', () => {
  assert.equal(stageOpportunity([t('a'), t('b', { priority: 'high' })]), 'Fix b')
  assert.equal(stageOpportunity([t('a', { opportunity: null })]), 'Address: a')
  assert.equal(stageOpportunity([]), null)
})

test('pain points are the pain-point themes only', () => {
  const list = [t('a'), t('b', { category: 'delight' }), t('c', { priority: 'high' })]
  assert.deepEqual((stagePainPoints(list) as { title: string }[]).map((x) => x.title), ['c', 'a'])
})

test('sentiment is the mean severity, ignoring themes without one', () => {
  assert.equal(stageSentiment([t('a', { severity: -0.8 }), t('b', { severity: 0.4 })]), -0.2)
  assert.equal(stageSentiment([t('a', { severity: null })]), null)
  assert.equal(stageSentiment([]), null)
})

test('the chart puts positive high, negative low and zero in the middle, clamped to the box', () => {
  assert.deepEqual([sentimentTop(0), sentimentTop(1), sentimentTop(-1), sentimentTop(5)], [50, 10, 90, 10])
})
