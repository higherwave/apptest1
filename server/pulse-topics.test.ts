// The grouping and ranking rules of Pulse topics, with no database. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANNELS as UI_CHANNELS, CHANNEL_LABEL as UI_LABEL } from '../src/pages/pulse/channels.js'
import { bestTopic, CHANNELS, CHANNEL_LABEL, DEFAULT_WEIGHTS, groupSignals, terms, topicStats } from './pulse-topics.js'

const sig = (id: string, body: string) => ({ id, body })

test('words are lowercased, everyday words dropped and endings trimmed', () => {
  assert.deepEqual(terms('The scores were DROPPING, and nobody trusted them!'), ['score', 'dropp', 'nobody', 'trust'])
})

test('signals about the same concept are grouped under its name; one that fits nowhere is left out; the same input gives the same answer', () => {
  const signals = [
    sig('a', 'I do not trust the score, it was wrong last quarter.'),
    sig('b', 'Can the score explain which factors moved it?'),
    sig('c', 'Handoffs to support lose the history, so I redo the investigation.'),
    sig('d', 'We need the context passed on with every handoff.'),
    sig('e', 'The timeline is lovely.'),
  ]
  const groups = groupSignals(signals)
  const byTitle = Object.fromEntries(groups.map((g) => [g.title, g.ids.slice().sort()]))
  assert.deepEqual(byTitle, { 'Handoffs and lost context': ['c', 'd'], 'Trust and accuracy': ['a', 'b'] })
  assert.deepEqual(groupSignals(signals), groups, 'deterministic')
  assert.deepEqual(groupSignals([sig('x', 'one lonely thought about nothing in particular')]), [], 'a single signal is not a topic')
})

test('signals that match no concept are still grouped by the rare words they share', () => {
  const groups = groupSignals([
    sig('1', 'The warehouse barcode scanner keeps rejecting pallets.'),
    sig('2', 'Our barcode scanner jams on every pallet in the warehouse.'),
    sig('3', 'Nothing related here at all, just a remark about lunch.'),
  ])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].ids.sort(), ['1', '2'])
})

test('a new signal joins the topic it fits best, or none', () => {
  const topics = [
    { id: 't1', bodies: ['The score is wrong again.', 'I do not trust this score.'] },
    { id: 't2', bodies: ['Weekly digest please.', 'The weekly digest would save time.'] },
  ]
  assert.equal(bestTopic('Why did the score change?', topics), 't1')
  assert.equal(bestTopic('A weekly digest of changes', topics), 't2')
  assert.equal(bestTopic('Completely unrelated lunch remark', topics), null)
})

test('a topic score is the weighted sum of its signals per channel, shown in full, with reach and trend', () => {
  const today = new Date('2026-11-20T12:00:00Z')
  const stats = topicStats(
    [
      { channel: 'call_notes', account: 'Northwind', saidBy: 'A', occurredOn: '2026-11-18', createdAt: '2026-11-18T00:00:00Z' },
      { channel: 'call_notes', account: 'northwind ', saidBy: 'B', occurredOn: '2026-11-10', createdAt: '2026-11-10T00:00:00Z' },
      { channel: 'slack', account: 'Contoso', saidBy: 'C', occurredOn: '2026-11-19', createdAt: '2026-11-19T00:00:00Z' },
      { channel: 'slack', account: 'Unknown', saidBy: 'Dana', occurredOn: '2026-10-25', createdAt: '2026-10-25T00:00:00Z' },
    ],
    DEFAULT_WEIGHTS,
    today,
  )
  assert.equal(stats.signals, 4)
  assert.deepEqual(stats.channels, { call_notes: 2, slack: 2 })
  assert.equal(stats.channelCount, 2)
  assert.equal(stats.reach, 3, 'Northwind (twice, any capitals), Contoso and Dana, who has no account')
  assert.deepEqual(stats.breakdown, [{ channel: 'slack', count: 2, weight: 0.5, subtotal: 1 }, { channel: 'call_notes', count: 2, weight: 1, subtotal: 2 }])
  assert.equal(stats.score, 3)
  assert.equal(stats.trend, 'rising', 'three in the last 14 days, one in the 14 before')
  assert.equal(topicStats([{ channel: 'slack', account: null, saidBy: null, occurredOn: '2026-11-19', createdAt: '2026-11-19T00:00:00Z' }], DEFAULT_WEIGHTS, today).trend, 'new')
})

test('the screens list the same channels, with the same names, as the server', () => {
  assert.deepEqual([...UI_CHANNELS.map((c) => c.key)].sort(), [...CHANNELS].sort())
  for (const c of CHANNELS) assert.equal(UI_LABEL[c], CHANNEL_LABEL[c])
})
