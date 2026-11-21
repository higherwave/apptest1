// Pulse's rudimentary cleaning: near-copies of a signal already saved are left out, whichever way they arrive. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
import { recordingSlack } from './slack-recorder.js'
import { isRepeat } from './pulse-clean.js'
import { terms } from './pulse-topics.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

test('a near-copy is a repeat; a different point, or a very short line, is not', () => {
  const seen = [new Set(terms('The health score dropped overnight and nobody could tell me why it changed.'))]
  assert.equal(isRepeat('The health score dropped overnight and nobody could tell me why it changed!', seen), true, 'punctuation does not matter')
  assert.equal(isRepeat('health score DROPPED overnight, nobody could tell me why it changed', seen), true, 'neither do capitals or small words')
  assert.equal(isRepeat('Reports take hours to build by hand every Monday morning.', seen), false)
  assert.equal(isRepeat('Reports take hours to build by hand every Monday morning.', seen), true, 'a repeat inside one batch is caught too')
  assert.equal(isRepeat('too short', seen), false, 'too few words to judge')
})

test('a repeated import, a repeated paste and a Slack message quoted again add nothing; a dismissed signal does not come back', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  const rec = recordingSlack()
  const app = createApp({ env: { DEV_TOKEN: 's3cret' }, getDb: () => db, slack: rec.slack })
  const call = (method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  await call('PUT', '/pulse/preview', { enabled: true })
  const text = 'Customers keep asking where the weekly digest went after the release.\n\nThe renewal page is confusing for new admins who join late.\n\nThe renewal page is confusing for new admins who join late!'
  const first = await (await call('POST', '/pulse/signals/import', { text })).json()
  assert.deepEqual([first.created, first.duplicates], [2, 1], 'the repeat inside the paste is left out')
  const again = await (await call('POST', '/pulse/signals/import', { text })).json()
  assert.deepEqual([again.created, again.duplicates], [0, 3], 'pasting it all again adds nothing')

  const src = await (await call('POST', '/pulse/sources', { name: 'customer-feedback', mode: 'keep' })).json()
  const ts = (n: number) => `${Math.floor(Date.now() / 1000) - 3600 + n}.000100`
  rec.feeds['C_customer-feedback'] = [
    { ts: ts(1), text: 'Customers keep asking where the weekly digest went after the release', user: 'U1', bot: false, subtype: null },
    { ts: ts(2), text: 'Handoffs between support and success lose all the history of the case.', user: 'U2', bot: false, subtype: null },
  ]
  const read = await (await call('POST', `/pulse/sources/${src.id}/check`)).json()
  assert.deepEqual([read.added, read.duplicates], [1, 1], 'the digest complaint was already there from the notes')

  // A signal a person dismissed still counts as seen.
  const sigs = (await (await call('GET', '/pulse/signals')).json()).signals
  const renewal = sigs.find((s: any) => /renewal page/.test(s.body))
  await call('PATCH', `/pulse/signals/${renewal.id}`, { status: 'dismissed' })
  const back = await (await call('POST', '/pulse/signals/import', { text: 'The renewal page is confusing for new admins who join late.' })).json()
  assert.deepEqual([back.created, back.duplicates], [0, 1])
  assert.equal(Number((await pg.query<any>(`select count(*)::int as n from core.pulse_signals`)).rows[0].n), 3)

  // A person typing a signal in is never second-guessed.
  assert.equal((await call('POST', '/pulse/signals', { body: 'The renewal page is confusing for new admins who join late.' })).status, 201)
})
