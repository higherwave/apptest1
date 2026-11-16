// The security baseline: headers on every answer, a ceiling on costly requests, and errors that do not leak. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'

const TOKEN = { DEV_TOKEN: 's3cret' }
const auth = { authorization: 'Bearer s3cret', 'content-type': 'application/json', 'if-match': '1' }

test('every answer carries the content-type and referrer protections', async () => {
  const { db } = await createDemoDatabase()
  const app = createApp({ env: TOKEN, getDb: () => db })
  for (const path of ['/api/v1/health', '/api/v1/me', '/api/v1/no-such-route']) {
    const res = await app.request(path, { headers: auth })
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path)
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', path)
  }
})

test('a costly route answers 429 with Retry-After once one person passes the ceiling, and another person is not affected', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  await initWorkspace(pg, { name: 'Other', slug: 'other', owners: ['o@other.example.test'] })
  const as = (slug: string, email: string) => createApp({ env: { ...TOKEN, WORKSPACE_SLUG: slug, DEV_USER_EMAIL: email }, getDb: () => db })
  const mine = as('other', 'o@other.example.test')
  const invite = (app: ReturnType<typeof as>, n: number) => app.request('/api/v1/members', { method: 'POST', headers: auth, body: JSON.stringify({ email: `p${n}@other.example.test`, role: 'viewer' }) })
  let refused: Response | undefined
  for (let i = 0; i < 40 && !refused; i++) {
    const res = await invite(mine, i)
    if (res.status === 429) refused = res
    else assert.equal(res.status, 201)
  }
  assert.ok(refused, 'the thirty-first invitation in a minute is refused')
  assert.equal((await refused!.json()).error.code, 'rate_limited')
  assert.ok(Number(refused!.headers.get('retry-after')) >= 1)
  // Someone else, in another workspace, has their own allowance.
  const theirs = as('higherwave-demo', 'david@demo.signalflow.example')
  assert.equal((await invite(theirs, 1)).status, 201)
  // The counter lives in the database, so a new instance of the app (a cold start) sees the same count.
  assert.equal((await invite(as('other', 'o@other.example.test'), 99)).status, 429)
})

test('a failure in the limiter’s own storage lets the request through rather than taking the app down', async () => {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.exec(`alter table core.rate_limits rename to rate_limits_gone`)
  const app = createApp({ env: { ...TOKEN, DEV_USER_EMAIL: 'david@demo.signalflow.example' }, getDb: () => db })
  const res = await app.request('/api/v1/members', { method: 'POST', headers: auth, body: JSON.stringify({ email: 'new@demo.signalflow.example', role: 'viewer' }) })
  assert.equal(res.status, 201)
})

test('an unexpected error answers 500 without its detail, and logs only its name and message', async () => {
  const { db } = await createDemoDatabase()
  const logged: unknown[][] = []
  const original = console.error
  console.error = (...args: unknown[]) => void logged.push(args)
  try {
    const failing = { ...db, inWorkspace: () => ({ ...db, query: async () => { throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505', detail: 'Key (email)=(secret.person@example.test) already exists.' }) } }) } as any
    const app = createApp({ env: TOKEN, getDb: () => failing })
    const res = await app.request('/api/v1/projects', { headers: auth })
    assert.equal(res.status, 500)
    assert.deepEqual(await res.json(), { error: { code: 'internal_error', message: 'Something went wrong.' } })
  } finally {
    console.error = original
  }
  assert.ok(logged.length > 0)
  assert.ok(!JSON.stringify(logged).includes('secret.person@example.test'), 'a typed value must not reach the log')
})
