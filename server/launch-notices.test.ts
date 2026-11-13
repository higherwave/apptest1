// Launch messages (slice 4): asking reviewers, telling the owner, reopened answers, escalation, steps nobody covers, and what is held back. No email leaves the
// machine: a recorder stands in for Microsoft Graph. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

// David (owner), Alex (editor) and Sam (viewer) get real-looking addresses, because placeholder ones are never mailed.
async function fixture(opts: { realAddresses?: boolean; env?: Record<string, string> } = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  if (opts.realAddresses !== false) await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const mailer = recordingMailer()
  const suffix = opts.realAddresses === false ? 'demo.signalflow.example' : 'acme-research.com'
  const env = { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', CRON_SECRET: 'cron-s3cret', ...(opts.env ?? {}) }
  const as = (who = 'david') => createApp({ env: { ...env, DEV_USER_EMAIL: `${who}@${suffix}` }, getDb: () => db, mailer })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david')
  const members = (await (await call(owner, 'GET', '/members')).json()).data as { id: string; email: string }[]
  const member = (key: string) => members.find((m) => m.email.startsWith(`${key}@`))!.id
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const reviewer = (who: string, steps: string[], role = 'primary') => call(owner, 'POST', '/reviewers', { memberId: member(who), steps, teams: 'all', role })
  return { pg, db, mailer, env, as, call, owner, project, reviewer }
}

// A launch started by Alex, with David covering product leadership and the final decision, Alex legal, Sam marketing (and Sam as alternate for legal).
async function launched(opts: Parameters<typeof fixture>[0] = {}) {
  const f = await fixture(opts)
  const alex = f.as('alex')
  const launch = await (await f.call(alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release', targetDate: '2026-12-01' })).json()
  await f.reviewer('david', ['product_leadership', 'final_decision'])
  await f.reviewer('alex', ['legal'])
  await f.reviewer('sam', ['marketing'])
  await f.reviewer('sam', ['legal'], 'alternate')
  return { ...f, alex, sam: f.as('sam'), david: f.as('david'), launch }
}

test('the launch owner asks the reviewers of the steps still waiting: one email each, listing their steps, with a link to the launch; asking again sends nothing', async () => {
  const { call, alex, sam, mailer, launch } = await launched()
  const asked = await call(alex, 'POST', `/launches/${launch.id}/request`)
  assert.equal(asked.status, 200)
  const body = await asked.json()
  assert.deepEqual(body.asked.map((a: any) => a.name).sort(), ['Alex Rivera', 'David Garrett', 'Sam Patel'].sort())
  assert.deepEqual(body.asked.find((a: any) => a.name === 'David Garrett').steps, ['Product leadership', 'Final decision'])
  assert.deepEqual(body.missing.map((m: any) => m.label), ['Sales', 'Documentation'], 'a step nobody covers is reported, not hidden')
  assert.equal(mailer.sent.length, 3)
  const toDavid = mailer.sent.find((m) => m.to === 'david@acme-research.com')!
  assert.equal(toDavid.subject, 'Signal Flow: your answer is wanted on Spring release')
  assert.match(toDavid.text, /Product leadership, Final decision/)
  assert.match(toDavid.text, /The target date is Dec 1, 2026\./)
  assert.ok(toDavid.text.includes(`https://app.example.test/launches/${launch.id}?step=product_leadership`), 'a link straight to their first step')
  assert.ok(toDavid.text.includes('https://app.example.test/launches'), 'and to all their reviews')
  assert.match(toDavid.html, /<a href="https:\/\/app\.example\.test\/launches\/[0-9a-f-]+\?step=product_leadership">Open the launch<\/a>/)
  // Again for the same brief: nothing more is sent.
  const again = await (await call(alex, 'POST', `/launches/${launch.id}/request`)).json()
  assert.deepEqual([again.asked.length, again.alreadyAsked.length], [0, 3])
  assert.equal(mailer.sent.length, 3)
  // A reviewer who is not an editor cannot ask.
  assert.equal((await call(sam, 'POST', `/launches/${launch.id}/request`)).status, 403)
})

test('an answer is told to the launch owner; the final decision to the owner and every reviewer; nobody is told of their own answer', async () => {
  const { call, alex, sam, david, mailer, launch } = await launched()
  await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })
  assert.equal(mailer.sent.length, 0, 'the owner answering their own step hears nothing')
  const said = await call(sam, 'PUT', `/launches/${launch.id}/steps/marketing`, { answer: 'changes_needed', rationale: 'The press page is not ready.' })
  assert.equal(said.status, 200)
  assert.equal(mailer.sent.length, 1)
  assert.equal(mailer.sent[0].to, 'alex@acme-research.com')
  assert.equal(mailer.sent[0].subject, 'Signal Flow: Marketing on Spring release: changes needed')
  assert.match(mailer.sent[0].text, /Why: The press page is not ready\./)
  mailer.sent.length = 0
  await call(david, 'PUT', `/launches/${launch.id}/steps/final_decision`, { answer: 'go_with_conditions', rationale: 'Marketing follows.' })
  assert.deepEqual(mailer.sent.map((m) => m.to).sort(), ['alex@acme-research.com', 'sam@acme-research.com'])
  assert.ok(mailer.sent.every((m) => m.subject === 'Signal Flow: Spring release is go with conditions'))
  assert.match(mailer.sent[0].text, /recorded by David Garrett/)
})

test('a change to the brief notes asks the reviewers to confirm at once, once', async () => {
  const { call, alex, sam, mailer, launch } = await launched()
  await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })
  await call(sam, 'PUT', `/launches/${launch.id}/steps/marketing`, { answer: 'ready' })
  mailer.sent.length = 0
  await call(alex, 'PATCH', `/launches/${launch.id}`, { briefNotes: 'The consent flow changed.' })
  assert.deepEqual(mailer.sent.map((m) => m.to).sort(), ['alex@acme-research.com', 'sam@acme-research.com'])
  assert.ok(mailer.sent.every((m) => m.subject === 'Signal Flow: please confirm your answer on Spring release'))
  assert.match(mailer.sent.find((m) => m.to === 'sam@acme-research.com')!.text, /changed after you answered Marketing/)
  await call(alex, 'PATCH', `/launches/${launch.id}`, { name: 'Spring' }) // not the brief
  const cron = await call(alex, 'GET', '/launches') // reading sends nothing
  assert.equal(cron.status, 200)
  assert.equal(mailer.sent.length, 2)
})

test('a request that has waited: alternates are asked to cover after 3 days and the owner is told after 6, once each', async () => {
  const { db, call, alex, mailer, env, launch, reviewer } = await launched()
  const { sweepLaunches } = await import('./launch-notices.js')
  await reviewer('david', ['sales', 'documentation']) // covered, so only the waiting is in play here
  await call(alex, 'POST', `/launches/${launch.id}/request`)
  mailer.sent.length = 0
  const at = (days: number) => ({ db, env, mailer, now: new Date(Date.now() + days * 86400000) })
  assert.deepEqual(await sweepLaunches(at(2)), { sent: 0, held: 0, failed: 0 }, 'not yet')
  const day4 = await sweepLaunches(at(4))
  // Sam is the alternate for legal; the other waiting steps have none, so the owner hears of those at once.
  assert.equal(day4.sent, 6)
  const alt = mailer.sent.filter((m) => m.to === 'sam@acme-research.com')
  assert.equal(alt.length, 1)
  assert.equal(alt[0].subject, 'Signal Flow: Legal on Spring release is waiting. Can you cover it?')
  const owner = mailer.sent.filter((m) => m.to === 'alex@acme-research.com')
  assert.deepEqual(owner.map((m) => m.subject).sort(), ['Documentation', 'Final decision', 'Marketing', 'Product leadership', 'Sales'].map((x) => `Signal Flow: ${x} on Spring release is still waiting`))
  assert.deepEqual(await sweepLaunches(at(4)), { sent: 0, held: 0, failed: 0 }, 'each goes once')
  const day7 = await sweepLaunches(at(7))
  assert.equal(day7.sent, 1, 'the owner now hears of legal too, which had an alternate')
  assert.equal(mailer.sent.at(-1)!.subject, 'Signal Flow: Legal on Spring release is still waiting')
})

test('a step nobody covers is told to the owner once a week, and only after something was asked', async () => {
  const { db, call, alex, mailer, env, launch } = await launched()
  const { sweepLaunches } = await import('./launch-notices.js')
  const deps = (days = 0) => ({ db, env, mailer, now: new Date(Date.now() + days * 86400000) })
  assert.equal((await sweepLaunches(deps())).sent, 0, 'nothing was asked yet')
  await call(alex, 'POST', `/launches/${launch.id}/request`)
  mailer.sent.length = 0
  const first = await sweepLaunches(deps())
  assert.equal(first.sent, 2, 'sales and documentation have no reviewer')
  assert.deepEqual(mailer.sent.map((m) => m.subject).sort(), ['Signal Flow: no reviewer for Documentation on Spring release', 'Signal Flow: no reviewer for Sales on Spring release'])
  assert.match(mailer.sent[0].text, /Admin, Members, Reviewers/)
  assert.equal((await sweepLaunches(deps())).sent, 0, 'once this week')
  assert.equal((await sweepLaunches(deps(8))).sent >= 2, true, 'and again the next week')
})

test('held, not lost: the recipient limit keeps the others’ messages, which go out when asked again once it is lifted; placeholder addresses are never mailed', async () => {
  const limited = await launched({ env: { REMINDERS_ONLY_FOR: 'david@acme-research.com' } })
  const res = await (await limited.call(limited.alex, 'POST', `/launches/${limited.launch.id}/request`)).json()
  assert.deepEqual([res.asked.map((a: any) => a.name), res.held.map((a: any) => a.name).sort()], [['David Garrett'], ['Alex Rivera', 'Sam Patel']])
  assert.deepEqual(limited.mailer.sent.map((m) => m.to), ['david@acme-research.com'])
  const held = (await limited.pg.query<any>(`select count(*)::int n from core.notifications where status = 'held' and kind = 'launch.requested'`)).rows[0].n
  assert.equal(held, 2)
  // The limit lifted (a new app without it): asking again sends what was held, and not what already went.
  const open = createApp({ env: { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', DEV_USER_EMAIL: 'alex@acme-research.com' }, getDb: () => limited.db, mailer: limited.mailer })
  const again = await (await limited.call(open, 'POST', `/launches/${limited.launch.id}/request`)).json()
  assert.deepEqual([again.asked.map((a: any) => a.name).sort(), again.alreadyAsked.map((a: any) => a.name)], [['Alex Rivera', 'Sam Patel'], ['David Garrett']])
  assert.equal(limited.mailer.sent.length, 3)
  // Placeholder addresses (the demo's own) are held, never mailed.
  const demo = await launched({ realAddresses: false })
  const placeholder = await (await demo.call(demo.alex, 'POST', `/launches/${demo.launch.id}/request`)).json()
  assert.deepEqual([placeholder.asked.length, placeholder.held.length, demo.mailer.sent.length], [0, 3, 0])
})

test('a failed email never fails an answer, and is retried the next time it is asked for', async () => {
  const { pg, call, alex, mailer, launch } = await launched()
  mailer.failNext = 'Graph said no'
  const res = await call(alex, 'POST', `/launches/${launch.id}/request`)
  assert.equal(res.status, 200)
  const failed = (await pg.query<any>(`select status, error from core.notifications where kind = 'launch.requested' and status = 'failed'`)).rows
  assert.equal(failed.length >= 1, true)
  assert.match(failed[0].error, /Graph said no/)
  const retry = await (await call(alex, 'POST', `/launches/${launch.id}/request`)).json()
  assert.equal(retry.asked.length >= 1, true, 'the failed one is sent now')
})

test('the hourly job also sends the launch messages that are due, and says how many', async () => {
  const { call, owner, alex, mailer, launch } = await launched()
  await call(alex, 'POST', `/launches/${launch.id}/request`)
  mailer.sent.length = 0
  const run = await owner.request('/api/v1/cron/digest', { headers: { authorization: 'Bearer cron-s3cret' } })
  assert.equal(run.status, 200)
  const body = await run.json()
  assert.deepEqual(Object.keys(body.launches).sort(), ['failed', 'held', 'sent'])
  assert.equal(body.launches.sent, 2, 'a step nobody covers: sales and documentation, to the owner')
})
