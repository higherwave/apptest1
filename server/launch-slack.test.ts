// A launch in Slack (slice 5): the channel a team sets, the thread each launch gets there, the replies, and what happens when Slack is off or fails.
// Slack never leaves the machine: a recorder stands in for it. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { cleanChannel, makeSlack, SlackError, slackText, type SlackClient } from './slack.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

type Posted = { channel: string; text: string; threadTs?: string; blocks?: unknown; ts: string }
function recordingSlack(opts: { live?: boolean } = {}) {
  const posts: Posted[] = []
  const state = { failNext: 0, n: 0 }
  const slack: SlackClient = {
    live: opts.live ?? true,
    async channelId(name) {
      if (name === 'missing-channel') throw new SlackError('channel_not_found')
      return `C_${name}`
    },
    async post(channel, text, threadTs, blocks) {
      if (state.failNext > 0) {
        state.failNext--
        throw new SlackError('ratelimited')
      }
      const ts = `1700000000.${String(++state.n).padStart(6, '0')}`
      posts.push({ channel, text, threadTs, blocks, ts })
      return { channel, ts }
    },
    async updateMessage() {},
    async openView() {},
    async respond() {},
    async permalink(channel, ts) {
      return `https://example-workspace.slack.test/archives/${channel}/p${ts.replace('.', '')}`
    },
  }
  return { slack, posts, state }
}

async function fixture(opts: { live?: boolean } = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const rec = recordingSlack(opts)
  const env = { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test' }
  const as = (who = 'david') => createApp({ env: { ...env, DEV_USER_EMAIL: `${who}@acme-research.com` }, getDb: () => db, mailer: recordingMailer(), slack: rec.slack })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david')
  const alex = as('alex')
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const teamId = ((await pg.query<any>(`select team_id from core.projects where id = $1`, [project])).rows[0] as { team_id: string }).team_id
  const members = (await (await call(owner, 'GET', '/members')).json()).data as { id: string; email: string }[]
  const member = (key: string) => members.find((m) => m.email.startsWith(`${key}@`))!.id
  const setChannel = (channel: string | null) => call(owner, 'PUT', `/teams/${teamId}/slack-channel`, { channel })
  const reviewer = (who: string, steps: string[]) => call(owner, 'POST', '/reviewers', { memberId: member(who), steps, teams: 'all', role: 'primary' })
  return { pg, call, owner, alex, project, teamId, setChannel, reviewer, ...rec }
}

test('a team sets its channel (owners only); a name is cleaned, a bad one is refused, and it shows in the team list', async () => {
  const { call, alex, owner, teamId, setChannel } = await fixture()
  assert.equal((await call(alex, 'PUT', `/teams/${teamId}/slack-channel`, { channel: 'x' })).status, 403)
  const set = await setChannel('  #Anchor-CX-Launches ')
  assert.equal(set.status, 200)
  assert.equal((await set.json()).data.find((t: any) => t.id === teamId).slackChannel, 'anchor-cx-launches')
  assert.equal((await setChannel('not a channel!')).status, 422)
  assert.equal((await (await call(owner, 'GET', '/teams')).json()).data.find((t: any) => t.id === teamId).slackChannel, 'anchor-cx-launches')
  const cleared = await (await setChannel('')).json()
  assert.equal(cleared.data.find((t: any) => t.id === teamId).slackChannel, null)
  assert.equal(cleanChannel('#Launches'), 'launches')
  assert.equal(cleanChannel('a b'), null)
})

test('a launch in a team with no channel posts nothing, and says so; once the team has one, the owner opens the thread, once', async () => {
  const { call, alex, project, posts, setChannel } = await fixture()
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, { name: 'Spring release' })).json()
  assert.equal(posts.length, 0)
  assert.deepEqual(launch.slack, { channel: null, started: false, threadUrl: null })
  const none = await (await call(alex, 'POST', `/launches/${launch.id}/slack`)).json()
  assert.equal(none.state, 'no_channel')
  await setChannel('anchor-cx-launches')
  const started = await (await call(alex, 'POST', `/launches/${launch.id}/slack`)).json()
  assert.equal(started.state, 'started')
  assert.equal(posts.length, 1)
  assert.equal(posts[0].channel, 'C_anchor-cx-launches')
  assert.equal(posts[0].threadTs, undefined, 'the first message opens the thread')
  assert.match(posts[0].text, /\*Launch: Spring release\*/)
  assert.ok(posts[0].text.includes(`<https://app.example.test/launches/${launch.id}|Open the launch in Signal Flow>`))
  const again = await (await call(alex, 'POST', `/launches/${launch.id}/slack`)).json()
  assert.equal(again.state, 'already')
  assert.equal(posts.length, 1)
  const shown = await (await call(alex, 'GET', `/launches/${launch.id}`)).json()
  assert.equal(shown.slack.started, true)
  assert.equal(shown.slack.channel, 'anchor-cx-launches')
  assert.match(shown.slack.threadUrl, /slack\.test\/archives\/C_anchor-cx-launches\//)
})

test('a launch made after the team has a channel opens its thread at once; what happens next is replied in that thread, each event once, and user text is escaped', async () => {
  const { call, alex, owner, project, posts, setChannel, reviewer } = await fixture()
  await setChannel('anchor-cx-launches')
  await reviewer('alex', ['legal'])
  await reviewer('david', ['product_leadership', 'final_decision'])
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, { name: 'Spring release' })).json()
  assert.equal(posts.length, 1, 'the thread is open as soon as the launch exists')
  const root = posts[0].ts
  await call(alex, 'POST', `/launches/${launch.id}/request`)
  assert.match(posts[1].text, /Answers asked of/)
  assert.equal(posts[1].threadTs, root, 'a reply, in the launch’s thread')
  const afterAsk = posts.length
  await call(alex, 'POST', `/launches/${launch.id}/request`)
  assert.equal(posts.length, afterAsk, 'asking again for the same brief posts nothing more')
  await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'changes_needed', rationale: 'Fix the <!channel> consent & wording.' })
  const answered = posts.find((p) => /\*Legal\*: changes needed/.test(p.text) && !p.blocks)!
  assert.equal(answered.threadTs, root)
  assert.match(answered.text, /\*Legal\*: changes needed, by Alex Rivera\./)
  assert.ok(answered.text.includes('Fix the &lt;!channel&gt; consent &amp; wording.'), 'a reason cannot mention anyone or add a link')
  assert.ok(!answered.text.includes('<!channel>'))
  await call(owner, 'PUT', `/launches/${launch.id}/steps/final_decision`, { answer: 'no_go', rationale: 'Not yet.' })
  assert.ok(posts.some((p) => /\*Final decision: no-go\*, recorded by David Garrett\./.test(p.text)))
  // A change to the brief reopens the answers given (Legal and the final decision): one reply each, however many times the sweep runs.
  await call(alex, 'PATCH', `/launches/${launch.id}`, { briefNotes: 'The consent flow changed.' })
  const reopened = posts.filter((p) => /brief changed/.test(p.text))
  assert.equal(reopened.length, 2)
  await call(alex, 'PATCH', `/launches/${launch.id}`, { briefNotes: 'The consent flow changed.' })
  assert.equal(posts.filter((p) => /brief changed/.test(p.text)).length, 2)
})

test('Slack off or failing never fails the action; a failed thread can be opened again', async () => {
  const off = await fixture({ live: false })
  await off.setChannel('anchor-cx-launches')
  const made = await off.call(off.alex, 'POST', `/projects/${off.project}/launch`, { name: 'Spring release' })
  assert.equal(made.status, 201, 'a launch is made with Slack off')
  const launch = await made.json()
  assert.equal((await (await off.call(off.alex, 'POST', `/launches/${launch.id}/slack`)).json()).state, 'off')
  assert.equal(off.posts.length, 0)

  const f = await fixture()
  await f.setChannel('anchor-cx-launches')
  await f.reviewer('alex', ['legal'])
  f.state.failNext = 1
  const l = await (await f.call(f.alex, 'POST', `/projects/${f.project}/launch`, { name: 'Spring release' })).json()
  assert.equal(l.slack.started, false, 'the post failed, the launch is still there')
  assert.equal((await f.call(f.alex, 'PUT', `/launches/${l.id}/steps/legal`, { answer: 'ready' })).status, 200, 'and answering still works')
  assert.deepEqual(f.posts.map((p) => !!p.threadTs), [false, true], 'answering opened the thread the failed post had not, then replied in it')
  assert.equal((await (await f.call(f.alex, 'POST', `/launches/${l.id}/slack`)).json()).state, 'already')
  const again = await fixture()
  await again.setChannel('anchor-cx-launches')
  again.state.failNext = 1
  const a = await (await again.call(again.alex, 'POST', `/projects/${again.project}/launch`, { name: 'Spring release' })).json()
  assert.equal((await (await again.call(again.alex, 'POST', `/launches/${a.id}/slack`)).json()).state, 'started', 'a failed thread is opened again on request')
  const bad = await fixture()
  await bad.setChannel('missing-channel')
  const b = await (await bad.call(bad.alex, 'POST', `/projects/${bad.project}/launch`, { name: 'x' })).json()
  const result = await (await bad.call(bad.alex, 'POST', `/launches/${b.id}/slack`)).json()
  assert.equal(result.state, 'failed')
  assert.match(result.problem, /cannot find that channel/)
})

test('the Slack client: finds a channel across pages, posts with the token, and maps errors', async () => {
  const calls: { url: string; init?: RequestInit }[] = []
  const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const client = makeSlack({ SLACK_BOT_TOKEN: 'xoxb-test' }, async (url, init) => {
    calls.push({ url, init })
    if (url.includes('conversations.list')) return url.includes('cursor=next') ? reply({ ok: true, channels: [{ id: 'C2', name: 'launches' }] }) : reply({ ok: true, channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: 'next' } })
    if (url.includes('chat.postMessage')) return JSON.parse(String(init?.body)).channel === 'nope' ? reply({ ok: false, error: 'channel_not_found' }) : reply({ ok: true, channel: 'C2', ts: '1.2' })
    return reply({ ok: true, permalink: 'https://x.slack.test/p' })
  })
  assert.equal(makeSlack({}).live, false)
  assert.equal(client.live, true)
  assert.equal(await client.channelId('launches'), 'C2')
  assert.equal(calls.length, 2)
  await client.channelId('launches')
  assert.equal(calls.length, 2, 'remembered')
  assert.deepEqual(await client.post('C2', 'hi', '9.9'), { channel: 'C2', ts: '1.2' })
  const post = calls.at(-1)!
  assert.equal((post.init?.headers as Record<string, string>).authorization, 'Bearer xoxb-test')
  assert.deepEqual(JSON.parse(String(post.init?.body)), { channel: 'C2', text: 'hi', unfurl_links: false, unfurl_media: false, thread_ts: '9.9' })
  await assert.rejects(() => client.post('nope', 'x'), (e: SlackError) => e.code === 'channel_not_found')
  await assert.rejects(() => client.channelId('absent'), (e: SlackError) => e.code === 'channel_not_found')
  assert.equal(await client.permalink('C2', '1.2'), 'https://x.slack.test/p')
  assert.equal(slackText('<a> & b'), '&lt;a&gt; &amp; b')
  // A reply goes only to Slack's own address.
  await assert.rejects(() => client.respond('https://evil.example.com/hook', { text: 'x' }), (e: SlackError) => e.code === 'bad_response_url')
  await client.respond('https://hooks.slack.com/actions/T/1/x', { text: 'x' })
  assert.equal(calls.at(-1)!.url, 'https://hooks.slack.com/actions/T/1/x')
})
