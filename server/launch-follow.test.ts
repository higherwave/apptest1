// Following a launch (slice 6): who follows, the early digest, and sharing it by email and in the Slack thread. Nothing leaves the machine: recorders stand
// in for mail and Slack. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { SlackError, type SlackClient } from './slack.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

async function fixture(extraEnv: Record<string, string> = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const mailer = recordingMailer()
  const posts: { text: string; threadTs?: string }[] = []
  let n = 0
  const slack: SlackClient = {
    live: true,
    async channelId(name) {
      if (name === 'missing') throw new SlackError('channel_not_found')
      return `C_${name}`
    },
    async post(channel, text, threadTs) {
      posts.push({ text, threadTs })
      return { channel, ts: `1700000000.${String(++n).padStart(6, '0')}` }
    },
    async permalink() {
      return 'https://example-workspace.slack.test/archives/C/p1'
    },
  }
  const env = { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', ...extraEnv }
  const as = (who = 'david') => createApp({ env: { ...env, DEV_USER_EMAIL: `${who}@acme-research.com` }, getDb: () => db, mailer, slack })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david')
  const alex = as('alex')
  const sam = as('sam')
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const teamId = ((await pg.query<any>(`select team_id from core.projects where id = $1`, [project])).rows[0] as { team_id: string }).team_id
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, { name: 'Spring release' })).json()
  const idOf = (who: string, l: { follow: { candidates: { userId: string; name: string }[]; followers: { userId: string; name: string }[] } }) => [...l.follow.candidates, ...l.follow.followers].find((p) => p.name.toLowerCase().startsWith(who))!.userId
  return { pg, call, owner, alex, sam, mailer, posts, teamId, project, launch, idOf }
}

test('editors choose who follows; only internal members can, others cannot change it, and the changes are in the audit log', async () => {
  const { call, owner, alex, sam, launch, idOf, pg } = await fixture()
  assert.deepEqual(launch.follow.followers, [])
  assert.ok(launch.follow.candidates.length >= 3, 'internal members are offered')
  assert.equal((await call(sam, 'POST', `/launches/${launch.id}/followers`, { userIds: [idOf('sam', launch)] })).status, 403, 'a viewer cannot')
  const added = await call(alex, 'POST', `/launches/${launch.id}/followers`, { userIds: [idOf('sam', launch), idOf('david', launch)] })
  assert.equal(added.status, 201)
  const l = await added.json()
  assert.deepEqual(l.follow.followers.map((f: any) => f.name).sort(), ['David Garrett', 'Sam Patel'])
  assert.ok(!l.follow.candidates.some((c: any) => c.name === 'Sam Patel'), 'a follower is no longer offered')
  assert.equal((await call(alex, 'POST', `/launches/${launch.id}/followers`, { userIds: [idOf('sam', launch)] })).status, 201, 'adding someone again is harmless')
  // An external member is never offered and cannot be added.
  const members = (await (await call(owner, 'GET', '/members')).json()).data
  assert.ok(members.length > 0)
  await call(owner, 'POST', '/members', { email: 'counsel@outside-firm.com', role: 'viewer', external: true })
  const external = ((await pg.query<any>(`select id from core.users where email = 'counsel@outside-firm.com'`)).rows[0] as { id: string }).id
  assert.equal((await call(alex, 'POST', `/launches/${launch.id}/followers`, { userIds: [external] })).status, 422)
  const removed = await (await call(alex, 'DELETE', `/launches/${launch.id}/followers/${idOf('sam', l)}`)).json()
  assert.deepEqual(removed.follow.followers.map((f: any) => f.name), ['David Garrett'])
  const audit = (await (await call(owner, 'GET', '/audit?limit=50')).json()).data as { verb: string }[]
  assert.ok(audit.some((a) => a.verb === 'follower_added') && audit.some((a) => a.verb === 'follower_removed'))
})

test('the digest: where people struggled first, a quote as said and never tied to a person, the brief, and the prompt; only an editor sees it', async () => {
  const { call, alex, sam, launch, pg } = await fixture()
  assert.equal((await call(sam, 'GET', `/launches/${launch.id}/digest`)).status, 403)
  const res = await call(alex, 'GET', `/launches/${launch.id}/digest`)
  assert.equal(res.status, 200)
  const d = await res.json()
  assert.equal(d.subject, 'Signal Flow: what we are learning on Spring release')
  assert.match(d.text, /What the research found/)
  assert.match(d.text, /Does everyone understand\? Any concerns\?/)
  assert.ok(d.themeCount > 0 && d.shown > 0 && d.shown <= 5)
  const titles = (await pg.query<any>(`select title from research.themes t where project_id = (select project_id from delivery.launches where id = $1) limit 50`, [launch.id])).rows.map((r: any) => r.title as string)
  assert.ok(titles.some((t) => d.text.includes(t)), 'a theme of the project is in it')
  assert.ok(d.text.indexOf('struggled') !== -1 || d.text.indexOf('need') !== -1)
  assert.match(d.text, /“[^”]+” \(one participant\)/, 'a quote as said, with no name')
  const names = (await pg.query<any>(`select name from research.participants`)).rows.map((r: any) => r.name as string).filter((n: string) => n.length > 3)
  for (const n of names) assert.ok(!d.text.includes(n), `${n} is not named`)
  assert.equal(d.hasBrief, true, 'the demo project’s requirements are published')
  assert.match(d.text, /The problem: /)
  assert.match(d.text, /\d+ requirements are written\./)
})

test('sharing: email to every follower once, a reply in the Slack thread, a record of what was sent; neither chosen is refused; the recipient limit holds email back', async () => {
  const { call, alex, mailer, posts, teamId, owner, launch, idOf } = await fixture()
  await call(owner, 'PUT', `/teams/${teamId}/slack-channel`, { channel: 'anchor-cx-launches' })
  await call(alex, 'POST', `/launches/${launch.id}/followers`, { userIds: [idOf('sam', launch), idOf('david', launch)] })
  assert.equal((await call(alex, 'POST', `/launches/${launch.id}/digest`, { email: false, slack: false })).status, 422)
  const shared = await call(alex, 'POST', `/launches/${launch.id}/digest`, { email: true, slack: true })
  assert.equal(shared.status, 200)
  const r = await shared.json()
  assert.deepEqual([r.followers, r.emailed, r.held, r.failed, r.slack], [2, 2, 0, 0, 'posted'])
  assert.deepEqual(mailer.sent.map((m) => m.to).sort(), ['david@acme-research.com', 'sam@acme-research.com'])
  const mail = mailer.sent[0]
  assert.equal(mail.subject, 'Signal Flow: what we are learning on Spring release')
  assert.match(mail.text, /Alex Rivera is sharing an early look at Spring release, which you follow\./)
  assert.match(mail.text, /Does everyone understand\?/)
  assert.ok(!mail.text.includes('/launches/'), 'no link: a follower cannot open the launch, so nothing in it points there')
  const reply = posts.at(-1)!
  assert.ok(reply.threadTs, 'a reply in the launch’s thread')
  assert.match(reply.text, /:mag: \*What we are learning: Spring release\*/)
  assert.equal(posts.length, 2, 'the thread opener, then the digest')
  const shown = await (await call(alex, 'GET', `/launches/${launch.id}`)).json()
  assert.equal(shown.follow.lastShared.emailed, 2)
  assert.equal(shown.follow.lastShared.inSlack, true)
  assert.equal(shown.follow.lastShared.by, 'Alex Rivera')
  // Sharing again is a new share: it goes out again.
  await call(alex, 'POST', `/launches/${launch.id}/digest`, { email: true, slack: false })
  assert.equal(mailer.sent.length, 4)
})

test('with the temporary recipient limit set, digest email goes only to that address and the rest are held; with Slack off it says so', async () => {
  const f = await fixture({ REMINDERS_ONLY_FOR: 'david@acme-research.com' })
  await f.call(f.alex, 'POST', `/launches/${f.launch.id}/followers`, { userIds: [f.idOf('sam', f.launch), f.idOf('david', f.launch)] })
  const r = await (await f.call(f.alex, 'POST', `/launches/${f.launch.id}/digest`, { email: true, slack: true })).json()
  assert.deepEqual([r.emailed, r.held], [1, 1])
  assert.deepEqual(f.mailer.sent.map((m) => m.to), ['david@acme-research.com'])
  assert.equal(r.slack, 'not_posted', 'this team has no channel')
  const none = await fixture()
  assert.equal((await (await none.call(none.alex, 'POST', `/launches/${none.launch.id}/digest`, { email: false, slack: true })).json()).slack, 'not_posted')
})
