import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clip, dateRange, draftLabel, heardTitle, longDate } from './storyboardText'

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
