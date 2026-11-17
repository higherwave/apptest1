// What a launch's Slack thread holds, kept short: the storyboard and the requirements are one message each, edited in place when they change; publishing the requirements
// asks for the answers (no Ask button); the last answer before the final decision tells the person with the final decision it is theirs. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { contextForUser } from './context.js'
import { afterRequirements } from './launch-updates.js'
import { recordingMailer } from './mailer.js'
import { recordingSlack } from './slack-recorder.js'
import { createDemoDatabase, setApprovers } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  await pg.query(`update core.users set email = replace(email, 'demo.signalflow.example', 'acme-research.com') where email like '%@demo.signalflow.example'`)
  const rec = recordingSlack()
  const mailer = recordingMailer()
  const env = { DEV_TOKEN: 's3cret', BETTER_AUTH_URL: 'https://app.example.test', SLACK_BOT_TOKEN: 'xoxb-test' }
  const as = (who: string) => createApp({ env: { ...env, DEV_USER_EMAIL: `${who}@acme-research.com` }, getDb: () => db, mailer, slack: rec.slack })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david')
  const alex = as('alex')
  const sam = as('sam')
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const teamId = ((await pg.query<any>(`select team_id from core.projects where id = $1`, [project])).rows[0] as { team_id: string }).team_id
  const workspaceId = ((await pg.query<any>(`select workspace_id from core.projects where id = $1`, [project])).rows[0] as { workspace_id: string }).workspace_id
  const reviewer = (who: string, steps: string[]) => setApprovers((m, p, b) => call(owner, m, p, b), who, steps)
  await call(owner, 'PUT', `/teams/${teamId}/slack-channel`, { channel: 'anchor-cx-launches' })
  await reviewer('alex', ['legal', 'sales', 'documentation'])
  await reviewer('sam', ['marketing'])
  await reviewer('david', ['product_leadership', 'final_decision'])
  const userId = ((await pg.query<any>(`select id from core.users where email = 'alex@acme-research.com'`)).rows[0] as { id: string }).id
  const ctx = (await contextForUser(db, workspaceId, userId))!
  return { pg, db, rec, mailer, env, call, owner, alex, sam, project, workspaceId, ctx }
}

const thread = (f: Awaited<ReturnType<typeof fixture>>) => f.rec.posts.filter((p) => p.threadTs)

test('the storyboard is one message in the thread: a rewrite edits it in place (no new post), and a message deleted in Slack is posted again', async () => {
  const f = await fixture()
  assert.equal((await f.call(f.alex, 'POST', `/projects/${f.project}/storyboard/generate`)).status, 200)
  const first = thread(f).filter((p) => /Storyboard/.test(p.text))
  assert.equal(first.length, 1)
  assert.match(first[0].text, /Nothing to answer yet/)
  assert.ok(JSON.stringify(first[0].blocks).includes('Open the storyboard'), 'a card with one link button')
  assert.ok(!/theme|quote/i.test(first[0].text), 'no research content in Slack')
  const posted = f.rec.posts.length

  await f.pg.query(`update research.storyboards set generated_at = generated_at + interval '1 day' where project_id = $1`, [f.project]) // a rewrite
  await f.call(f.alex, 'POST', `/projects/${f.project}/storyboard/generate`)
  assert.equal(f.rec.posts.length, posted, 'no new message, so no new notification')
  assert.ok(f.rec.updates.some((u) => u.ts === first[0].ts && /Updated/.test(u.text)), 'the same message now says it was updated')

  f.rec.state.updateError = 'message_not_found' // deleted in Slack
  await f.call(f.alex, 'POST', `/projects/${f.project}/storyboard/generate`)
  f.rec.state.updateError = null
  assert.equal(thread(f).filter((p) => /Storyboard/.test(p.text)).length, 2, 'deleted in Slack: posted again, once')
})

test('publishing the requirements asks for the answers by itself, once: one message for the document and one running status, and nobody pressed Ask', async () => {
  const f = await fixture()
  await f.call(f.alex, 'POST', `/projects/${f.project}/storyboard/generate`) // starts the launch
  const asked = () => f.mailer.sent.filter((m) => /your answer is wanted/.test(m.subject))
  assert.equal(asked().length, 0)
  await afterRequirements({ db: f.db, env: f.env, mailer: f.mailer, slack: f.rec.slack }, f.ctx, f.project)
  assert.deepEqual(asked().map((m) => m.to).sort(), ['alex@acme-research.com', 'david@acme-research.com', 'sam@acme-research.com'])
  const doc = thread(f).filter((p) => /Requirements published/.test(p.text))
  assert.equal(doc.length, 1)
  assert.match(doc[0].text, /Needs an answer from: .*Legal/)
  assert.equal(thread(f).filter((p) => /Where it stands/.test(p.text)).length, 1, 'the running status')
  const posts = f.rec.posts.length
  const mails = f.mailer.sent.length

  await afterRequirements({ db: f.db, env: f.env, mailer: f.mailer, slack: f.rec.slack }, f.ctx, f.project) // published again
  assert.equal(f.rec.posts.length, posts, 'a second publish edits the message')
  assert.equal(f.mailer.sent.length, mails, 'and asks nobody twice')
  assert.ok(f.rec.updates.some((u) => /Requirements published: Updated/.test(u.text)))
})

test('the last answer before the final decision tells the person with the final decision it is theirs (once), and the thread’s status says so', async () => {
  const f = await fixture()
  await f.call(f.alex, 'POST', `/projects/${f.project}/storyboard/generate`)
  await afterRequirements({ db: f.db, env: f.env, mailer: f.mailer, slack: f.rec.slack }, f.ctx, f.project)
  const launchId = ((await f.pg.query<any>(`select id from delivery.launches where project_id = $1`, [f.project])).rows[0] as { id: string }).id
  const ready = () => f.mailer.sent.filter((m) => /ready for your sign-off/.test(m.subject))
  for (const [app, step] of [[f.alex, 'legal'], [f.alex, 'sales'], [f.alex, 'documentation'], [f.sam, 'marketing']] as const) {
    assert.equal((await f.call(app, 'PUT', `/launches/${launchId}/steps/${step}`, { answer: 'ready' })).status, 200)
    assert.equal(ready().length, 0, 'not yet: a step is still open')
  }
  assert.equal((await f.call(f.owner, 'PUT', `/launches/${launchId}/steps/product_leadership`, { answer: 'ready_with_conditions', rationale: 'Watch the cost.' })).status, 200)
  assert.deepEqual(ready().map((m) => m.to), ['david@acme-research.com'])
  assert.match(ready()[0].text, /with 1 condition/)
  assert.ok(f.rec.updates.some((u) => /Ready for the final decision/.test(u.text)))
  await f.call(f.alex, 'PUT', `/launches/${launchId}/steps/legal`, { answer: 'ready' }) // answering again must not repeat the alert
  assert.equal(ready().length, 1)
  assert.equal((await f.call(f.owner, 'PUT', `/launches/${launchId}/steps/final_decision`, { answer: 'go' })).status, 200)
  assert.ok(f.rec.updates.some((u) => /Signed off with 1 condition/.test(u.text)), 'the status ends on the sign-off')
  assert.ok(f.mailer.sent.some((m) => /signed off with 1 condition/.test(m.subject)))
})
