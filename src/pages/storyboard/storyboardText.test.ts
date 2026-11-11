import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clip, dateRange, draftLabel, heardTitle, inlineHeight, longDate, paginateRows, rowHeight, slidePlan, slideTitle } from './storyboardText'

test('dates read in UTC and share the year and month', () => {
  assert.equal(longDate('2026-11-12'), '12 November 2026')
  assert.equal(longDate('2026-11-12T23:30:00.000Z'), '12 November 2026')
  assert.equal(dateRange('2026-09-15', '2026-10-24'), '15 September to 24 October 2026')
  assert.equal(dateRange('2026-10-05', '2026-10-24'), '5 to 24 October 2026')
  assert.equal(dateRange('2025-12-20', '2026-01-10'), '20 December 2025 to 10 January 2026')
  assert.equal(dateRange('2026-10-05', '2026-10-05'), '5 October 2026')
})

test('a long quote is cut at a word with an ellipsis, a short one is left alone', () => {
  assert.equal(clip('Short and sweet.', 40), 'Short and sweet.')
  assert.equal(clip('I check the CRM, the support queue and a usage dashboard before every call.', 40), 'I check the CRM, the support queue and…')
  assert.equal(clip('Unbroken'.repeat(10), 20), 'UnbrokenUnbrokenUnbr…')
})

test('the slide wording', () => {
  assert.equal(heardTitle(5, 18), 'The 5 strongest themes across 18 participants')
  assert.equal(heardTitle(1, 1), 'The strongest theme across 1 participant')
  assert.match(draftLabel('template'), /without the AI model/)
  assert.match(draftLabel('model'), /best guess/)
})

const row = (len: number, name = 'Account risk timeline') => ({ name, description: 'A short description of the solution.', themes: [{ title: 'The health score cannot be explained' }], benefit: 'b'.repeat(len), cost: 'c'.repeat(len), risk: 'r'.repeat(len), giveUp: 'g'.repeat(len), alternatives: 'a'.repeat(len) })

test('short trade-offs share one slide; long ones carry on to a continued slide, and no row is left out or split', () => {
  assert.deepEqual(paginateRows([row(60), row(60), row(60)]), [[0, 1, 2]])
  const long = [row(160), row(160), row(160)]
  const pages = paginateRows(long)
  assert.ok(pages.length > 1, 'three rows of 160 characters do not fit one slide')
  assert.deepEqual(pages.flat(), [0, 1, 2], 'every row appears once, in order')
  assert.ok(pages.every((p) => p.length > 0))
  assert.deepEqual(paginateRows([row(160)]), [[0]], 'a single row always has a slide')
  assert.deepEqual(paginateRows([]), [[]])
  assert.ok(rowHeight(row(160)) > rowHeight(row(40)))
})

test('the trade-offs sit under their solution when they fit there, and get slides of their own only when they do not', () => {
  const short = slidePlan([row(40)])
  assert.deepEqual(short.map((s) => s.kind), ['title', 'problem', 'heard', 'solutions', 'close'])
  assert.equal(short[3].inline, true)
  assert.ok(!slidePlan([row(160)]).some((s) => s.inline), 'long trade-offs do not fit under one solution')
  assert.ok(!slidePlan([row(40), row(40), row(40)]).some((s) => s.inline), 'three columns are too narrow for five trade-offs each')
  assert.ok(slidePlan([row(160), row(160)]).some((s) => s.kind === 'tradeoffs'))
  assert.ok(inlineHeight(row(160), 1) > inlineHeight(row(40), 1))
})

test('the deck is five slides, plus one for each further page of trade-offs, with the closing slide last', () => {
  assert.deepEqual(slidePlan([row(60), row(60), row(60)]).map((s) => s.kind), ['title', 'problem', 'heard', 'solutions', 'tradeoffs', 'close'])
  const plan = slidePlan([row(160), row(160), row(160)])
  assert.deepEqual(plan.map((s) => s.kind), ['title', 'problem', 'heard', 'solutions', ...plan.filter((s) => s.kind === 'tradeoffs').map(() => 'tradeoffs'), 'close'])
  const trade = plan.filter((s) => s.kind === 'tradeoffs')
  assert.ok(trade.length >= 2 && trade.every((s, i) => s.part === i + 1 && s.parts === trade.length))
  assert.equal(slideTitle(trade[0]), 'Trade-offs')
  assert.equal(slideTitle(trade[1]), 'Trade-offs (continued)')
})
