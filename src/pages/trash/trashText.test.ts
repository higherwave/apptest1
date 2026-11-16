import { test } from 'node:test'
import assert from 'node:assert/strict'
import { plural, summaryText } from './trashText'

test('what was in a deleted item reads as a short list, in a fixed order, leaving out what is zero', () => {
  assert.equal(summaryText({ themes: 7, transcripts: 4 }), '4 transcripts · 7 themes')
  assert.equal(summaryText({ participants: 1, stories: 1, launches: 2, requirements: 0 }), '1 participant · 1 story · 2 launches')
  assert.equal(summaryText({}), '')
  assert.equal(plural(1, 'day'), '1 day')
  assert.equal(plural(90, 'day'), '90 days')
})
