// Marking a reviewer away: needs an alternate for every step they are primary for, tells the alternates, and a launch page link now points at the
// Product Brief tab. No email leaves the machine: a recorder stands in for Microsoft Graph. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { createDemoDatabase, setApprovers } from './test-utils.js'
import { documentUrl, stageLine } from './launch-updates.js'
import { T } from '../shared/terms.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const mailer = recordingMailer()
  const owner = createApp({ env: { DEV_TOKEN: 's3cret', DEV_USER_EMAIL: 'david@acme-research.com', BETTER_AUTH_URL: 'https://app.example.test' }, getDb: () => db, mailer })
  const call = (method: string, path: string, body?: unknown) => owner.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const members = (await (await call('GET', '/members')).json()).data as { id: string; email: string }[]
  const member = (key: string) => members.find((m) => m.email.startsWith(`${key}@`))!.id
  const reviewer = (who: string, steps: string[], role: 'primary' | 'alternate' = 'primary') => setApprovers(call, who, steps, role)
  // The away route names a person (user id), not a membership.
  const person = async (key: string) => ((await pg.query<any>(`select id from core.users where email = $1`, [`${key}@acme-research.com`])).rows[0] as { id: string }).id
  return { mailer, call, member, person, reviewer }
}

test(`${T.a('approver')} with no ${T.backup} cannot be marked away, and nothing changes or is sent`, async () => {
  const { call, person, reviewer, mailer } = await fixture()
  await reviewer('david', ['product_leadership'])
  const res = await call('PUT', `/approvals/people/${await person('david')}`, { unavailable: true })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.code, 'no_backup')
  const overview = await (await call('GET', '/approvals')).json()
  assert.ok(overview.people.every((p: any) => !p.unavailable))
  assert.equal(mailer.sent.length, 0)
})

test(`every step needs ${T.a('backup')}: one covered step is not enough`, async () => {
  const { call, person, reviewer } = await fixture()
  await reviewer('david', ['product_leadership', 'legal'])
  await reviewer('sam', ['legal'], 'alternate')
  assert.equal((await call('PUT', `/approvals/people/${await person('david')}`, { unavailable: true })).status, 409)
  await reviewer('sam', ['product_leadership'], 'alternate')
  assert.equal((await call('PUT', `/approvals/people/${await person('david')}`, { unavailable: true })).status, 200)
})

test('a person with no primary assignments has nothing to hand over', async () => {
  const { call, person, reviewer } = await fixture()
  await reviewer('sam', ['legal'], 'alternate')
  assert.equal((await call('PUT', `/approvals/people/${await person('sam')}`, { unavailable: true })).status, 409)
})

test('marking a reviewer away emails each alternate once, names the steps, and going back sends nothing', async () => {
  const { call, person, reviewer, mailer } = await fixture()
  await reviewer('david', ['product_leadership', 'legal'])
  await reviewer('sam', ['product_leadership', 'legal'], 'alternate')
  const away = await call('PUT', `/approvals/people/${await person('david')}`, { unavailable: true })
  assert.equal(away.status, 200)
  assert.ok((await away.json()).people.filter((p: any) => p.email.startsWith('david@')).every((p: any) => p.unavailable))
  assert.equal(mailer.sent.length, 1)
  const m = mailer.sent[0]
  assert.equal(m.to, 'sam@acme-research.com')
  assert.match(m.text, /David Garrett is away/)
  assert.match(m.text, /Product leadership, Legal/)
  assert.ok(m.text.includes('https://app.example.test/launches'))
  // Marking away again changes nothing and sends nothing more.
  await call('PUT', `/approvals/people/${await person('david')}`, { unavailable: true })
  assert.equal(mailer.sent.length, 1)
  // Back: no email.
  assert.equal((await call('PUT', `/approvals/people/${await person('david')}`, { unavailable: false })).status, 200)
  assert.equal(mailer.sent.length, 1)
})

test('an alternate who is away themselves does not count as cover', async () => {
  const { call, person, reviewer } = await fixture()
  await reviewer('david', ['legal'])
  await reviewer('sam', ['legal'], 'alternate')
  await reviewer('sam', ['sales'])
  await reviewer('alex', ['sales'], 'alternate')
  assert.equal((await call('PUT', `/approvals/people/${await person('sam')}`, { unavailable: true })).status, 200)
  assert.equal((await call('PUT', `/approvals/people/${await person('david')}`, { unavailable: true })).status, 409)
})

test('messages about a document link to the launch’s Product Brief tab, where the Docs panel opens it', () => {
  const env = { APP_URL: 'https://app.example.test/' } as never
  assert.equal(documentUrl(env, 'abc', 'storyboard'), 'https://app.example.test/launches/abc?tab=brief')
  assert.equal(documentUrl(env, 'abc', 'requirements'), 'https://app.example.test/launches/abc?tab=brief')
  assert.equal(stageLine('requirements'), 'Storyboard > Requirements (now) > Ready for approval')
})
