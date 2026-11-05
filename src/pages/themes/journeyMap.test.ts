// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sentimentTop, sentimentWord, stageBackstage, stageFlow, stageOpportunity, stagePainPoints, stageSentiment, strongestFirst } from './journeyMap.js'

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

test('backstage (simulated): inferred from the stage name and its themes, strongest match first, at most three, none for an empty stage', () => {
  assert.deepEqual(stageBackstage('Find a provider', []), [])
  const booking = stageBackstage('Book a time', [t('Provider availability is hard to see', { description: 'No calendar of open slots' })]) as { text: string }[]
  assert.equal(booking[0].text, 'Scheduling team')
  assert.ok(booking.length <= 3 && new Set(booking.map((b) => b.text)).size === booking.length)
  assert.equal(stageBackstage('Confirm & pay', [t('Fees surprise people')])[0].text, 'Billing and insurance team')
  assert.deepEqual(stageBackstage('Stage', [t('Zzz', { description: 'qqq' })]), [{ kind: 'Team', text: 'Operations team' }])
})

test('user flow (simulated): start, the two strongest themes, a decision where it reads negative, and where it goes next', () => {
  assert.deepEqual(stageFlow('Book', [], 'Pay'), { sentiment: null, steps: [], next: 'Pay' })
  const flow = stageFlow('Book', [t('a', { totalParticipants: 5 }), t('b', { priority: 'high', category: 'pain_point', totalParticipants: 5 }), t('c', { category: 'delight', severity: 0.9 })], 'Pay')
  assert.deepEqual(flow.steps.map((s) => `${s.kind}:${s.text}`), ['Start:Book', 'Friction:b', 'Friction:a', 'Decision:Keeps going?'])
  assert.equal(flow.steps[1].tone, 'negative')
  assert.equal(flow.next, 'Pay')
  const good = stageFlow('Done', [t('c', { category: 'delight', severity: 0.9 })], null)
  assert.deepEqual(good.steps.map((s) => s.kind), ['Start', 'Delight'])
  assert.equal(good.next, null)
})

test('a stage feels negative, mixed or positive by its mean severity', () => {
  assert.deepEqual([sentimentWord(-0.5), sentimentWord(0), sentimentWord(0.5), sentimentWord(null)], ['Negative', 'Mixed', 'Positive', null])
})
