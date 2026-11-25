// The grouping and ranking rules of Pulse topics, with no database. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CHANNELS as UI_CHANNELS, CHANNEL_LABEL as UI_LABEL } from '../src/pages/pulse/channels.js'
import { bestTopic, CHANNELS, QUIET_AFTER_DAYS, recencyFactor, MAX_QUESTIONS, suggestQuestions, CHANNEL_LABEL, DEFAULT_WEIGHTS, groupSignals, terms, topicStats } from './pulse-topics.js'

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
  assert.deepEqual(stats.breakdown, [{ channel: 'call_notes', count: 2, praise: 0, faded: 0, weight: 1, subtotal: 2 }, { channel: 'slack', count: 2, praise: 0, faded: 0, weight: 0.5, subtotal: 1 }])
  assert.equal(stats.score, 3)
  assert.equal(stats.trend, 'rising', 'three in the last 14 days, one in the 14 before')
  assert.equal(topicStats([{ channel: 'slack', account: null, saidBy: null, occurredOn: '2026-11-19', createdAt: '2026-11-19T00:00:00Z' }], DEFAULT_WEIGHTS, today).trend, 'new')
})

test('the screens list the same channels, with the same names, as the server', () => {
  assert.deepEqual([...UI_CHANNELS.map((c) => c.key)].sort(), [...CHANNELS].sort())
  for (const c of CHANNELS) assert.equal(UI_LABEL[c], CHANNEL_LABEL[c])
})

test('suggested questions: one open question per topic, then one built on its strongest quote, then follow-ups, about one session in all', () => {
  const quote = (id: string, body: string, channel: 'slack' | 'call_notes', at: string) => ({ id, body, saidBy: 'Marcus', channel, at })
  const topics = [
    { id: 't1', title: 'Trust and accuracy', quotes: [quote('a', 'Slack says it is wrong.', 'slack', '2026-11-19'), quote('b', 'I do not trust the score.', 'call_notes', '2026-11-01')] },
    { id: 't2', title: 'Reporting and digests', quotes: [quote('c', 'I build the report by hand.', 'slack', '2026-11-10')] },
    { id: 't3', title: 'Renewal preparation', quotes: [quote('d', 'Five tabs for one renewal.', 'call_notes', '2026-11-05')] },
  ]
  const qs = suggestQuestions(topics, 'Contextual (walk-through)')
  assert.equal(qs.length, MAX_QUESTIONS)
  assert.deepEqual(qs.slice(0, 3).map((q) => q.topicTitle), ['Trust and accuracy', 'Reporting and digests', 'Renewal preparation'], 'a topic each first')
  assert.match(qs[0].prompt, /^Walk me through the last time trust and accuracy came up/)
  assert.equal(qs[0].evidence?.signalId, 'b', 'the strongest quote is the one from the channel that weighs most')
  const asked = qs.filter((q) => q.prompt.startsWith('A customer told us:'))
  assert.equal(asked.length, 3)
  assert.ok(asked.every((q) => q.evidence && q.prompt.includes(q.evidence.quote)), 'the quote is the signal\'s own words')
  assert.deepEqual(suggestQuestions(topics, 'Survey').map((q) => q.prompt).filter((p) => /1 to 5/.test(p)).length > 0, true, 'wording follows the method')
  assert.deepEqual(suggestQuestions(topics, 'not a method'), suggestQuestions(topics, 'User Discussions'), 'an unknown method falls back')
  assert.equal(suggestQuestions([{ id: 'x', title: 'Solo', quotes: [] }], 'Survey').length, 2, 'no quote, no quote question')
})

test('older signals count less: in full for 30 days, then fading in a straight line to a quarter at 90 days', () => {
  assert.deepEqual([0, 10, 30].map(recencyFactor), [1, 1, 1])
  assert.equal(recencyFactor(60), 0.625, 'halfway through the fade')
  assert.deepEqual([90, 200].map(recencyFactor), [0.25, 0.25])
  const today = new Date('2026-12-01T12:00:00Z')
  const at = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
  const row = (daysAgo: number) => ({ channel: 'call_notes' as const, account: null, saidBy: null, occurredOn: at(daysAgo), createdAt: '2026-11-01T00:00:00Z' })
  const stats = topicStats([row(2), row(30), row(90), row(120)], DEFAULT_WEIGHTS, today)
  assert.equal(stats.score, 2.5, 'two in full (a day 30 signal still counts in full) and two at a quarter')
  assert.deepEqual(stats.breakdown, [{ channel: 'call_notes', count: 4, praise: 0, faded: 2, weight: 1, subtotal: 2.5 }], 'the breakdown says how many were older')
  assert.equal(stats.signals, 4, 'every signal is still counted as heard')
})

test('a topic is quiet when its newest signal is over 60 days old, and loud again when something new arrives', () => {
  const today = new Date('2026-12-01T12:00:00Z')
  const at = (daysAgo: number) => new Date(today.getTime() - daysAgo * 86_400_000).toISOString().slice(0, 10)
  const row = (daysAgo: number) => ({ channel: 'slack' as const, account: null, saidBy: null, occurredOn: at(daysAgo), createdAt: '2026-01-01T00:00:00Z' })
  assert.equal(QUIET_AFTER_DAYS, 60)
  const quiet = topicStats([row(70), row(90)], DEFAULT_WEIGHTS, today)
  assert.deepEqual([quiet.quiet, quiet.lastHeardOn], [true, at(70)])
  assert.equal(topicStats([row(59), row(90)], DEFAULT_WEIGHTS, today).quiet, false, 'one signal within the 60 days keeps it from being quiet')
  assert.equal(topicStats([row(70), row(90), row(1)], DEFAULT_WEIGHTS, today).quiet, false, 'something new brings it back')
  assert.deepEqual([topicStats([], DEFAULT_WEIGHTS, today).quiet, topicStats([], DEFAULT_WEIGHTS, today).lastHeardOn], [false, null])
})
