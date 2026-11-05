// How the database size limit is read and when it alerts.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { databaseLimitBytes, levelOf } from './usage.js'

const MB = 1024 * 1024

test('the limit is DATABASE_SIZE_LIMIT_MB in bytes: 512 by default, none for 0 or "none", and a bad value falls back to the default', () => {
  assert.equal(databaseLimitBytes({}), 512 * MB)
  assert.equal(databaseLimitBytes({ DATABASE_SIZE_LIMIT_MB: '2048' }), 2048 * MB)
  assert.equal(databaseLimitBytes({ DATABASE_SIZE_LIMIT_MB: '0' }), null)
  assert.equal(databaseLimitBytes({ DATABASE_SIZE_LIMIT_MB: 'none' }), null)
  assert.equal(databaseLimitBytes({ DATABASE_SIZE_LIMIT_MB: 'lots' }), 512 * MB)
  assert.equal(databaseLimitBytes({ DATABASE_SIZE_LIMIT_MB: '-5' }), 512 * MB)
})

test('alerts come at half, 80% and the whole limit, like the AI spend', () => {
  assert.deepEqual([49, 50, 79, 80, 99, 100, 150].map((n) => levelOf(n, 100)), ['ok', 'half', 'half', 'high', 'high', 'reached', 'reached'])
  assert.equal(levelOf(null, 100), 'ok')
  assert.equal(levelOf(50, null), 'ok')
})
