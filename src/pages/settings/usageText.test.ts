// npm run test:api also runs these.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatBytes, share } from './usageText.js'

test('sizes read in the largest unit that keeps them short', () => {
  assert.equal(formatBytes(500), '1 KB')
  assert.equal(formatBytes(300 * 1024), '300 KB')
  assert.equal(formatBytes(7.25 * 1024 * 1024), '7.3 MB')
  assert.equal(formatBytes(120 * 1024 * 1024), '120 MB')
  assert.equal(formatBytes(1.5 * 1024 * 1024 * 1024), '1.50 GB')
})

test('the share of a limit is a whole percent', () => {
  assert.equal(share(128, 512), 25)
  assert.equal(share(600, 512), 117)
})
