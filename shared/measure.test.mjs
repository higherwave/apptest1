import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compatFields, goalText, readingText, sentenceText, signalText } from './measure.mjs'

const r1 = { metricKind: 'tickets', detail: 'asking why a score changed', comparison: 'change', valueA: '48', valueB: '15', unit: 'a month' }

test('a measure reads as one sentence', () => {
  assert.equal(signalText(r1), 'Support tickets asking why a score changed')
  assert.equal(goalText(r1), '48 → 15 a month')
  assert.equal(sentenceText(r1), "We'll know this worked when Support tickets asking why a score changed go from 48 to 15 a month.")
  assert.equal(sentenceText({ ...r1, comparison: 'below', valueA: '5%', valueB: '', unit: '' }), "We'll know this worked when Support tickets asking why a score changed stay below 5%.")
  assert.equal(sentenceText({ ...r1, comparison: 'between', valueA: '40%', valueB: '60%', unit: '' }), "We'll know this worked when Support tickets asking why a score changed stay between 40% and 60%.")
  assert.equal(goalText({ ...r1, comparison: 'reach', valueA: '20', valueB: '', unit: 'a week' }), 'goal 20 a week')
  assert.equal(goalText({ ...r1, comparison: 'above', valueA: '40%', unit: '' }), 'above 40%')
  assert.equal(sentenceText({ metricKind: 'other', detail: 'Calls about fees', comparison: 'reach', valueA: '55', unit: 'a week' }), "We'll know this worked when Calls about fees reach 55 a week.")
  assert.equal(sentenceText({}), '', 'nothing to say yet')
})

test('the plain metric, baseline and target are written from the parts, so what reads them keeps working', () => {
  assert.deepEqual(compatFields(r1), { metric: 'Support tickets asking why a score changed', baseline: '48 a month', target: '15 a month' })
  assert.deepEqual(compatFields({ ...r1, comparison: 'below', valueA: '5%', valueB: null, unit: '' }), { metric: 'Support tickets asking why a score changed', baseline: null, target: 'below 5%' })
  assert.deepEqual(compatFields({ metricKind: 'adoption', detail: 'of the digest' }), { metric: 'Adoption of the digest', baseline: null, target: null })
  assert.equal(compatFields({ metric: 'Old text', baseline: '1', target: '2' }), null, 'a row saved before the parts is left as it was')
})

test('a row saved before the parts shows its own metric, baseline and target', () => {
  const old = { metric: 'Escalations missed by the CSM', baseline: '9 a quarter', target: '2 a quarter' }
  assert.equal(signalText(old), 'Escalations missed by the CSM')
  assert.equal(goalText(old), '9 a quarter → 2 a quarter')
  assert.equal(goalText({ target: '60 a week' }), 'goal 60 a week')
})

test('a reading takes its unit only when it is a bare number', () => {
  assert.equal(readingText('11', 'a month'), '11 a month')
  assert.equal(readingText('11 a month', 'a month'), '11 a month')
  assert.equal(readingText('52%', ''), '52%')
  assert.equal(readingText('6 of 8', 'a week'), '6 of 8')
  assert.equal(readingText('', 'a month'), '')
})
