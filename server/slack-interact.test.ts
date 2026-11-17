// Acting from Slack (slice 7): signed requests only, connecting a Slack user with a one-time code, the approval card and its buttons, the answer form, the
// "Add link as evidence" action, and the refusals. Slack never leaves the machine: a recorder stands in for it. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { createApp } from './app.js'
import { recordingMailer } from './mailer.js'
import { recordingSlack } from './slack-recorder.js'
import { createDemoDatabase, setApprovers } from './test-utils.js'
import { postApprovalCards } from './launch-slack.js'
import { T } from '../shared/terms.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const SECRET = 'signing-secret-for-tests'
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const TEAM = 'T_TEST'

async function fixture(extraEnv: Record<string, string> = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const rec = recordingSlack()
  const mailer = recordingMailer()
  const env = { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', SLACK_SIGNING_SECRET: SECRET, SLACK_BOT_TOKEN: 'xoxb-test', ...extraEnv }
  const as = (who = 'david') => createApp({ env: { ...env, DEV_USER_EMAIL: `${who}@acme-research.com` }, getDb: () => db, mailer, slack: rec.slack })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david')
  const alex = as('alex')
  const sam = as('sam')
  const anon = as('david') // the Slack routes need no sign-in
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const teamId = ((await pg.query<any>(`select team_id from core.projects where id = $1`, [project])).rows[0] as { team_id: string }).team_id
  const members = (await (await call(owner, 'GET', '/members')).json()).data as { id: string; email: string }[]
  const reviewer = (who: string, steps: string[]) => setApprovers((m, p, b) => call(owner, m, p, b), who, steps)
  await call(owner, 'PUT', `/teams/${teamId}/slack-channel`, { channel: 'anchor-cx-launches' })
  await reviewer('alex', ['legal'])
  await reviewer('sam', ['marketing'])
  await reviewer('david', ['product_leadership', 'final_decision'])
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, { name: 'Spring release' })).json()

  let clock = Math.floor(Date.now() / 1000)
  const sign = (raw: string, ts = clock) => ({ 'x-slack-request-timestamp': String(ts), 'x-slack-signature': `v0=${createHmac('sha256', SECRET).update(`v0:${ts}:${raw}`).digest('hex')}`, 'content-type': 'application/x-www-form-urlencoded' })
  let n = 0
  const post = (path: string, form: Record<string, string>, extra: Record<string, string> = {}, ts?: number) => {
    // A different body each time unless asked, so two honest requests are never mistaken for a replay.
    const raw = new URLSearchParams({ ...form, _n: String(++n) }).toString()
    return anon.request(`/api/v1${path}`, { method: 'POST', headers: { ...sign(raw, ts), ...extra }, body: raw })
  }
  const interact = (payload: Record<string, unknown>, extra?: Record<string, string>) => post('/slack/interactions', { payload: JSON.stringify(payload) }, extra)
  const command = (user: string, text: string) => post('/slack/commands', { team_id: TEAM, user_id: user, text })
  // Connect a Slack user to a member through the real flow: a code in Signal Flow, entered in Slack.
  const connect = async (who: 'alex' | 'sam' | 'david', slackUser: string) => {
    const code = (await (await call(as(who), 'POST', '/me/slack/code')).json()).code as string
    return (await (await command(slackUser, `connect ${code}`)).json()).text as string
  }
  return { pg, call, owner, alex, sam, as, launch, project, teamId, post, interact, command, connect, sign, rec, mailer, env, db, advance: (s: number) => (clock += s) }
}

const click = (user: string, launchId: string, step: string, answer: string, extra: Record<string, unknown> = {}) => ({
  type: 'block_actions', user: { id: user, team_id: TEAM }, team: { id: TEAM }, trigger_id: `trig-${user}-${answer}`, response_url: 'https://hooks.slack.com/actions/T/1/x',
  actions: [{ action_id: `answer:${answer}`, value: `${launchId}|${step}` }], ...extra,
})

test('only requests Slack signed are acted on: a missing, wrong or old signature is refused, a replay is refused, a Slack retry is acknowledged, and no secret closes the door', async () => {
  const f = await fixture()
  const raw = new URLSearchParams({ payload: JSON.stringify({ type: 'nothing' }) }).toString()
  assert.equal((await f.post('/slack/interactions', {}, { 'x-slack-signature': '' })).status, 401, 'no signature')
  assert.equal((await f.post('/slack/interactions', {}, { 'x-slack-signature': 'v0=00' })).status, 401, 'a wrong signature')
  assert.equal((await f.post('/slack/interactions', {}, {}, Math.floor(Date.now() / 1000) - 600)).status, 401, 'older than five minutes')
  // The same signed request twice: the second is a replay.
  const headers1 = f.sign(raw)
  const a = await f.as().request('/api/v1/slack/interactions', { method: 'POST', headers: headers1, body: raw })
  const b = await f.as().request('/api/v1/slack/interactions', { method: 'POST', headers: headers1, body: raw })
  assert.equal(a.status, 200)
  assert.equal(b.status, 401, 'a replay')
  const c = await f.as().request('/api/v1/slack/interactions', { method: 'POST', headers: { ...headers1, 'x-slack-retry-num': '1' }, body: raw })
  assert.equal(c.status, 200, 'a Slack retry is acknowledged without being acted on again')
  const open = await fixture({ SLACK_SIGNING_SECRET: '' })
  assert.equal((await open.post('/slack/interactions', {})).status, 503)
})

test('connecting: a one-time code from Signal Flow, entered in Slack, links that Slack user to the member, once; a wrong, used or old code does nothing; disconnect undoes it', async () => {
  const f = await fixture()
  assert.equal((await (await f.call(f.alex, 'GET', '/me/slack')).json()).connected, false)
  const made = await (await f.call(f.alex, 'POST', '/me/slack/code')).json()
  assert.match(made.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  const wrong = await (await f.command('U_ALEX', 'connect ZZZZ-ZZZZ')).json()
  assert.match(wrong.text, /did not work/)
  const ok = await (await f.command('U_ALEX', `connect ${made.code.toLowerCase()}`)).json()
  assert.equal(ok.response_type, 'ephemeral')
  assert.match(ok.text, /Connected\. You are Alex Rivera/)
  assert.deepEqual(await (await f.call(f.alex, 'GET', '/me/slack')).json(), { connected: true, slackUserId: 'U_ALEX', configured: true })
  assert.match((await (await f.command('U_OTHER', `connect ${made.code}`)).json()).text, /did not work/, 'a code works once')
  // Ten minutes is the limit.
  const old = await (await f.call(f.sam, 'POST', '/me/slack/code')).json()
  await f.pg.query(`update core.slack_connect_codes set expires_at = now() - interval '1 minute'`)
  assert.match((await (await f.command('U_SAM', `connect ${old.code}`)).json()).text, /did not work/)
  assert.match((await (await f.command('U_ALEX', '')).json()).text, /is connected/)
  assert.match((await (await f.command('U_ALEX', 'disconnect')).json()).text, /Disconnected/)
  assert.equal((await (await f.call(f.alex, 'GET', '/me/slack')).json()).connected, false)
  // The code is not kept in the clear.
  const rows = (await f.pg.query<any>(`select code_hash from core.slack_connect_codes`)).rows as { code_hash: string }[]
  assert.ok(rows.every((r) => !made.code.includes(r.code_hash) && r.code_hash.length === 64))
})

test('asking for answers posts one running status message in the thread, edited as answers come in, and no card or post per step', async () => {
  const f = await fixture()
  await f.call(f.alex, 'POST', `/launches/${f.launch.id}/request`)
  const posted = f.rec.posts.filter((p) => p.threadTs)
  assert.equal(posted.length, 1, 'one message in the thread')
  assert.match(posted[0].text, /Where it stands: 0 of \d steps answered/)
  assert.ok(JSON.stringify(posted[0].blocks).includes('"url"'), 'a link button to the launch')
  assert.ok(!JSON.stringify(posted[0].blocks).includes('answer:'), 'no answer buttons: answers are given in Signal Flow')
  const before = f.rec.posts.length
  await f.call(f.alex, 'POST', `/launches/${f.launch.id}/request`)
  assert.equal(f.rec.posts.length, before, 'asking again posts nothing more')
  await f.call(f.alex, 'PUT', `/launches/${f.launch.id}/steps/legal`, { answer: 'ready' })
  assert.equal(f.rec.posts.length, before, 'an answer edits the status instead of posting')
  assert.ok(f.rec.updates.some((u) => /1 of \d steps answered/.test(u.text)))
})

// Cards posted before answers moved to the app still work: the click, the form and settling the card.
const oldCards = async (f: Awaited<ReturnType<typeof fixture>>) => {
  const workspaceId = ((await f.pg.query<any>(`select workspace_id from delivery.launches where id = $1`, [f.launch.id])).rows[0] as { workspace_id: string }).workspace_id
  await postApprovalCards({ db: f.db, env: f.env, slack: f.rec.slack }, workspaceId, f.launch.id, new Date().toISOString(), [{ step: 'marketing', label: 'Marketing', waitingFor: ['Sam Patel'] }])
}

test('a click: someone not connected is told how, a connected non-reviewer is refused politely naming who can, the reviewer gets the form', async () => {
  const f = await fixture()
  await f.call(f.alex, 'POST', `/launches/${f.launch.id}/request`)
  // Not connected.
  assert.equal((await f.interact(click('U_NOBODY', f.launch.id, 'legal', 'ready'))).status, 200)
  assert.equal(f.rec.views.length, 0)
  const told = f.rec.responses.at(-1)!
  assert.equal(told.body.response_type, 'ephemeral')
  assert.match(told.body.text, /Connect Slack/)
  assert.ok(told.body.text.includes(`https://app.example.test/launches/${f.launch.id}?step=legal`), 'and a link to answer in Signal Flow instead')
  // Connected, but Sam is not Legal's reviewer.
  await f.connect('sam', 'U_SAM')
  await f.interact(click('U_SAM', f.launch.id, 'legal', 'ready'))
  assert.equal(f.rec.views.length, 0)
  assert.match(f.rec.responses.at(-1)!.body.text, /Only Alex Rivera can answer Legal on Spring release\. Your click was not recorded\./)
  // Alex is.
  await f.connect('alex', 'U_ALEX')
  await f.interact(click('U_ALEX', f.launch.id, 'legal', 'changes_needed'))
  assert.equal(f.rec.views.length, 1)
  const v = f.rec.views[0]
  assert.equal(v.triggerId, 'trig-U_ALEX-changes_needed')
  assert.equal(v.view.callback_id, 'answer')
  assert.equal(v.view.title.text, 'Legal: Changes needed')
  assert.deepEqual(JSON.parse(v.view.private_metadata), { launchId: f.launch.id, step: 'legal', answer: 'changes_needed' })
  assert.equal(v.view.blocks[1].optional, false, 'this answer needs a reason')
  await f.interact(click('U_ALEX', f.launch.id, 'legal', 'ready'))
  assert.equal(f.rec.views[1].view.blocks[1].optional, true, 'a plain ready does not')
})

test('submitting the form records the answer as the member, needs a reason where the answer does, updates the card, the status and emails the owner', async () => {
  const f = await fixture()
  await f.call(f.alex, 'POST', `/launches/${f.launch.id}/request`)
  await oldCards(f)
  await f.connect('sam', 'U_SAM')
  const submit = (user: string, step: string, answer: string, why: string) =>
    f.interact({ type: 'view_submission', user: { id: user, team_id: TEAM }, team: { id: TEAM }, view: { callback_id: 'answer', private_metadata: JSON.stringify({ launchId: f.launch.id, step, answer }), state: { values: { why: { why: { value: why } } } } } })
  // Marketing is Sam's; the owner of the launch is Alex, who hears the answer.
  const refused = await submit('U_SAM', 'marketing', 'changes_needed', '  ')
  assert.deepEqual(await refused.json(), { response_action: 'errors', errors: { why: 'Say why: this answer needs a reason.' } })
  assert.equal((await (await f.call(f.alex, 'GET', `/launches/${f.launch.id}`)).json()).steps.find((s: any) => s.step === 'marketing').state, 'waiting', 'nothing was recorded')
  const done = await submit('U_SAM', 'marketing', 'changes_needed', 'The press page is not ready.')
  assert.equal(done.status, 200)
  assert.equal(await done.text(), '', 'an empty answer closes the form')
  const detail = await (await f.call(f.alex, 'GET', `/launches/${f.launch.id}`)).json()
  const m = detail.steps.find((s: any) => s.step === 'marketing')
  assert.equal(m.state, 'changes_needed')
  assert.equal(m.answer.by.name, 'Sam Patel')
  assert.equal(m.answer.rationale, 'The press page is not ready.')
  assert.ok(f.rec.updates.some((u) => /\*Marketing\*: changes needed, by Sam Patel\./.test(u.text) && !JSON.stringify(u.blocks).includes('"actions"')), 'the card stops offering buttons')
  assert.ok(f.rec.updates.some((u) => /Where it stands/.test(u.text) && /changes needed: Marketing/.test(u.text)), 'and the thread’s status message says it')
  assert.ok(f.mailer.sent.some((m) => m.to === 'alex@acme-research.com' && /Marketing/.test(m.subject)), 'the owner is emailed, as for an answer given in Signal Flow')
  // Someone who may not answer cannot, even with a form in hand.
  const bad = await submit('U_SAM', 'legal', 'ready', '')
  assert.match((await bad.json()).errors.why, /Only Alex Rivera can answer Legal/)
  // A plain ready needs no reason.
  await f.connect('alex', 'U_ALEX')
  assert.equal(await (await submit('U_ALEX', 'legal', 'ready', '')).text(), '')
  assert.equal((await (await f.call(f.alex, 'GET', `/launches/${f.launch.id}`)).json()).steps.find((s: any) => s.step === 'legal').state, 'ready')
})

test('"Add link as evidence" on a message in the launch thread: the reviewer picks a step and the link is recorded; others and other threads are refused', async () => {
  const f = await fixture()
  await f.call(f.alex, 'POST', `/launches/${f.launch.id}/slack`)
  const root = f.rec.posts[0]
  await f.connect('alex', 'U_ALEX')
  await f.connect('sam', 'U_SAM')
  const action = (user: string, ts = root.ts, channel = root.channel) => ({
    type: 'message_action', callback_id: 'add_evidence', user: { id: user, team_id: TEAM }, team: { id: TEAM }, trigger_id: `t-${user}`, response_url: 'https://hooks.slack.com/actions/T/1/x',
    channel: { id: channel }, message: { ts: '1700000999.000001', thread_ts: ts, text: 'The signed consent copy is here: https://docs.example.com/consent-v3 thanks' },
  })
  await f.interact(action('U_ALEX'))
  const view = f.rec.views.at(-1)!.view
  assert.equal(view.callback_id, 'evidence')
  assert.equal(view.blocks[1].element.initial_value, 'https://docs.example.com/consent-v3', 'the link in the message is offered')
  assert.deepEqual(view.blocks[0].element.options.map((o: any) => o.value), ['legal'], 'only the steps they answer')
  const submit = (url: string) => f.interact({ type: 'view_submission', user: { id: 'U_ALEX', team_id: TEAM }, team: { id: TEAM }, view: { callback_id: 'evidence', private_metadata: JSON.stringify({ launchId: f.launch.id }), state: { values: { step: { step: { selected_option: { value: 'legal' } } }, url: { url: { value: url } }, title: { title: { value: 'Consent copy v3' } } } } } })
  assert.deepEqual(await (await submit('ftp://nope')).json(), { response_action: 'errors', errors: { url: 'Enter a link that starts with http:// or https://.' } })
  assert.equal(await (await submit('https://docs.example.com/consent-v3')).text(), '')
  const links = (await (await f.call(f.alex, 'GET', `/launches/${f.launch.id}`)).json()).steps.find((s: any) => s.step === 'legal').links
  assert.deepEqual(links.map((l: any) => [l.title, l.url]), [['Consent copy v3', 'https://docs.example.com/consent-v3']])
  assert.ok(f.rec.posts.some((p) => /:paperclip: \*Legal\*: Alex Rivera added a link as evidence: <https:\/\/docs\.example\.com\/consent-v3\|Consent copy v3>/.test(p.text) && p.threadTs))
  // Sam reviews marketing only, so adding evidence is for his step: he is offered Marketing, not Legal.
  await f.interact(action('U_SAM'))
  assert.deepEqual(f.rec.views.at(-1)!.view.blocks[0].element.options.map((o: any) => o.value), ['marketing'])
  // Not a launch thread.
  const views = f.rec.views.length
  await f.interact(action('U_ALEX', '1700000000.999999', 'C_elsewhere'))
  assert.equal(f.rec.views.length, views)
  assert.match(f.rec.responses.at(-1)!.body.text, /not a launch thread/)
  // Someone who reviews no step of this launch.
  await f.connect('david', 'U_DAVID')
  await f.pg.query(`delete from core.reviewer_assignments where user_id = (select id from core.users where email like 'david@%')`)
  await f.interact(action('U_DAVID'))
  assert.equal(f.rec.views.length, views)
  assert.match(f.rec.responses.at(-1)!.body.text, new RegExp(`not ${T.a('approver')} of any step`))
})
