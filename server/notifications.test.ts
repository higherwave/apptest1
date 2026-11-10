// The daily reminder: who is told, when, about what, and when it stops. No email leaves the machine: a recorder stands in for Microsoft Graph.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { graphMailer, recordingMailer } from './mailer.js'
import { composeDigest, DIGEST, localParts, nextStep, runDigest, unsubscribeLink } from './notifications.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const TOKEN = 's3cret'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const ENV = { DEV_TOKEN: TOKEN, BETTER_AUTH_SECRET: 'a-test-secret-of-some-length', BETTER_AUTH_URL: 'https://app.example.test', CRON_SECRET: 'cron-s3cret', DEV_USER_EMAIL: 'david@acme-research.com' }
const DAY = (n: number) => new Date(Date.UTC(2026, 10, 10 + n, 11, 0)) // 11:00 UTC: 06:00 in New York (winter)

async function setup() {
  const { db } = await createDemoDatabase()
  // The demo people have placeholder addresses the reminder refuses to mail; give the owner a real-looking one and a time zone.
  await db.query(`update core.users set email = 'david@acme-research.com', time_zone = 'America/New_York' where email = 'david@demo.signalflow.example'`)
  const david = (await db.query(`select id from core.users where email = 'david@acme-research.com'`)).rows[0].id as string
  return { db, david, mailer: recordingMailer() }
}

test('the next step: Measure is never the reminder, a published project is done', () => {
  const base = { id: 'p1', status: 'analyzed' as const, sessions: 5, highPriority: 0 }
  assert.equal(nextStep({ ...base, status: 'draft', sessions: 0 }, { exists: false, published: false })?.path, '/projects/p1/plan')
  assert.match(nextStep({ ...base, status: 'draft' }, { exists: false, published: false })!.text, /^Analyze the 5 sessions/)
  assert.equal(nextStep({ ...base, highPriority: 2 }, { exists: false, published: false })?.path, '/projects/p1/prio')
  assert.equal(nextStep(base, { exists: false, published: false })?.path, '/projects/p1/themes')
  assert.equal(nextStep(base, { exists: true, published: false })?.path, '/projects/p1/requirements')
  assert.equal(nextStep(base, { exists: true, published: true }), null)
})

test('local time: 6am is read where the person is', () => {
  assert.deepEqual(localParts(DAY(0), 'America/New_York'), { hour: 6, date: '2026-11-10' })
  assert.equal(localParts(DAY(0), 'Asia/Kolkata')?.hour, 16)
  assert.equal(localParts(DAY(0), 'Not/AZone'), null)
})

test('the reminder goes to the editor at 6am their time, once, with a link to the next step', async () => {
  const { db, mailer } = await setup()
  const deps = { db, env: ENV, mailer }
  assert.equal((await runDigest({ ...deps, now: new Date(Date.UTC(2026, 10, 10, 10, 30)) })).sent, 0, 'not 6am yet there (5:30)')
  assert.equal((await runDigest({ ...deps, now: new Date(Date.UTC(2026, 10, 10, 14, 0)) })).sent, 0, 'too late to be a morning reminder (9:00)')
  const r = await runDigest({ ...deps, now: DAY(0) })
  assert.equal(r.sent, 1)
  assert.equal(mailer.sent.length, 1)
  assert.equal(mailer.sent[0].to, 'david@acme-research.com')
  assert.match(mailer.sent[0].text, /https:\/\/app\.example\.test\/projects\/[0-9a-f-]+\/\w+/)
  assert.match(mailer.sent[0].text, /unsubscribe\?u=/i)
  assert.equal((await runDigest({ ...deps, now: DAY(0) })).alreadySent, 1)
  assert.equal(mailer.sent.length, 1, 'a second run in the same hour sends nothing')
})

test('a late scheduled run still sends that morning, and only once', async () => {
  const { db, mailer } = await setup()
  const late = new Date(Date.UTC(2026, 10, 10, 13, 20)) // 8:20 in New York
  assert.equal((await runDigest({ db, env: ENV, mailer, now: late })).sent, 1)
  assert.equal((await runDigest({ db, env: ENV, mailer, now: DAY(0) })).alreadySent, 1)
})

test('people without a time zone, or who switched it off, are left alone', async () => {
  const { db, david, mailer } = await setup()
  await db.query(`insert into core.notification_preferences (user_id, kind, enabled) values ($1, $2, false)`, [david, DIGEST])
  assert.equal((await runDigest({ db, env: ENV, mailer, now: DAY(0) })).sent, 0)
  await db.query(`delete from core.notification_preferences`)
  await db.query(`update core.users set time_zone = null where id = $1`, [david])
  assert.equal((await runDigest({ db, env: ENV, mailer, now: DAY(0) })).sent, 0)
  assert.equal(mailer.sent.length, 0)
})

test('it stops after three reminders that say the same thing, and starts again when the project moves on', async () => {
  const { db, mailer } = await setup()
  for (const n of [0, 1, 2]) assert.equal((await runDigest({ db, env: ENV, mailer, now: DAY(n) })).sent, 1, `day ${n + 1}`)
  const fourth = await runDigest({ db, env: ENV, mailer, now: DAY(3) })
  assert.deepEqual([fourth.sent, fourth.nothingToSay], [0, 1])
  // One project moves on (its next step changes): it is mentioned again.
  const project = (await db.query(`select project_id from core.reminder_state limit 1`)).rows[0].project_id
  await db.query(`update core.reminder_state set fingerprint = 'something else' where project_id = $1`, [project])
  assert.equal((await runDigest({ db, env: ENV, mailer, now: DAY(4) })).sent, 1)
})

test('a failed send is recorded and tried again on the next run', async () => {
  const { db, mailer } = await setup()
  mailer.failNext = 'Graph said no'
  const first = await runDigest({ db, env: ENV, mailer, now: DAY(0) })
  assert.deepEqual([first.sent, first.failed], [0, 1])
  assert.equal((await db.query(`select status, error from core.notifications`)).rows[0].error, 'Graph said no')
  assert.equal((await db.query(`select count(*)::int n from core.reminder_state`)).rows[0].n, 0, 'a failed send does not count toward the stop')
  assert.equal((await runDigest({ db, env: ENV, mailer, now: DAY(0) })).sent, 1)
  assert.equal((await db.query(`select status from core.notifications`)).rows[0].status, 'sent')
})

test('"Send me a reminder now" ignores the clock, the switch and the stop rule, and does not count toward the stop', async () => {
  const { db, david, mailer } = await setup()
  await db.query(`update core.users set time_zone = null where id = $1`, [david])
  await db.query(`insert into core.notification_preferences (user_id, kind, enabled) values ($1, $2, false)`, [david, DIGEST])
  const r = await runDigest({ db, env: ENV, mailer, now: DAY(0) }, { userId: david })
  assert.equal(r.outcome, 'sent')
  assert.equal(mailer.sent.length, 1)
  assert.equal((await db.query(`select count(*)::int n from core.reminder_state`)).rows[0].n, 0)
})

test('the email escapes what people typed and names no sender', () => {
  const mail = composeDigest({ name: 'Pat <b>', items: [{ projectId: 'p', name: 'A & <script>', text: 'Go', path: '/projects/p/plan', fingerprint: 'f' }], base: 'https://x.test', settingsUrl: 'https://x.test/s', unsubscribe: null })
  assert.ok(!mail.html.includes('<script>') && !mail.html.includes('<b>'))
  assert.match(mail.html, /A &amp; &lt;script&gt;/)
})

test('Microsoft Graph: gets a token once, posts the message from the configured mailbox', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fakeFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return url.includes('/token') ? new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 })) : new Response(null, { status: 202 })
  }) as unknown as typeof fetch
  assert.equal(graphMailer({}, fakeFetch), undefined, 'not configured without all four settings')
  const m = graphMailer({ MAIL_TENANT_ID: 't', MAIL_CLIENT_ID: 'c', MAIL_CLIENT_SECRET: 's', MAIL_FROM: 'sender@acme-research.com' }, fakeFetch)!
  await m.send({ to: 'a@b.com', subject: 'S', text: 't', html: '<p>h</p>' })
  await m.send({ to: 'a@b.com', subject: 'S', text: 't', html: '<p>h</p>' })
  assert.equal(calls.filter((c) => c.url.includes('/token')).length, 1)
  const send = calls.find((c) => c.url.includes('sendMail'))!
  assert.ok(send.url.includes('/users/sender%40acme-research.com/sendMail'))
  assert.equal((send.init.headers as Record<string, string>).authorization, 'Bearer tok')
  const failing = graphMailer({ MAIL_TENANT_ID: 't', MAIL_CLIENT_ID: 'c', MAIL_CLIENT_SECRET: 's', MAIL_FROM: 'x@y.com' }, (async (u: string) => (u.includes('/token') ? new Response(JSON.stringify({ access_token: 't', expires_in: 60 })) : new Response('denied', { status: 403 }))) as unknown as typeof fetch)!
  await assert.rejects(failing.send({ to: 'a@b.com', subject: 'S', text: 't', html: 'h' }), /403/)
})

test('routes: settings, the test button, the signed unsubscribe link and the closed cron route', async () => {
  const { db, david, mailer } = await setup()
  const app = createApp({ env: ENV, getDb: () => db, mailer })
  const get = (p: string, headers: Record<string, string> = auth) => app.request(`/api/v1${p}`, { headers })
  const send = (p: string, method: string, body?: unknown) => app.request(`/api/v1${p}`, { method, headers: auth, body: body ? JSON.stringify(body) : undefined })

  const prefs = await (await get('/notifications/preferences')).json()
  assert.deepEqual([prefs.receives, prefs.digestEnabled, prefs.timeZone, prefs.mailConfigured], [true, true, 'America/New_York', true])
  assert.equal((await send('/notifications/preferences', 'PUT', { timeZone: 'Nowhere/Land' })).status, 422)
  assert.equal((await send('/notifications/preferences', 'PUT', { timeZone: 'Europe/London', digestEnabled: false })).status, 204)
  const after = await (await get('/notifications/preferences')).json()
  assert.deepEqual([after.digestEnabled, after.timeZone], [false, 'Europe/London'])

  assert.equal((await (await send('/notifications/digest/test', 'POST')).json()).outcome, 'sent')
  const quiet = createApp({ env: ENV, getDb: () => db, mailer: { name: 'none', live: false, send: async () => {} } })
  assert.equal((await (await quiet.request('/api/v1/notifications/digest/test', { method: 'POST', headers: auth })).json()).outcome, 'not_configured')

  // The link in the email is signed: a changed signature does nothing; the real one switches the reminder off, signed in or not.
  await db.query(`delete from core.notification_preferences`)
  const link = unsubscribeLink(ENV, '', david)!
  assert.equal((await app.request(link.replace(/t=\w+$/, 't=' + '0'.repeat(64)))).status, 400)
  assert.equal((await db.query(`select count(*)::int n from core.notification_preferences`)).rows[0].n, 0)
  assert.equal((await app.request(link)).status, 200)
  assert.equal((await db.query(`select enabled from core.notification_preferences where user_id = $1`, [david])).rows[0].enabled, false)

  assert.equal((await app.request('/api/v1/cron/digest')).status, 401)
  assert.equal((await app.request('/api/v1/cron/digest', { headers: { authorization: 'Bearer cron-s3cret' } })).status, 200)
  const closed = createApp({ env: { ...ENV, CRON_SECRET: undefined }, getDb: () => db, mailer })
  assert.equal((await closed.request('/api/v1/cron/digest')).status, 503)
})
