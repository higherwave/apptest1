// Published requirements lock their project: no new transcripts, analysis, theme edits or discarding the document. A workspace owner or the launch's final approver
// can return the requirements to draft (with a reason, audited) until a real Jira ticket exists; then it is permanent. Drafts are warned when the analysis changed
// their themes. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { contextForUser } from './context.js'
import { afterFirstTicket, afterRequirements } from './launch-updates.js'
import { compareThemes } from './specs.js'
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
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) =>
    app.request(`/api/v1${path}`, { method, headers: { ...headers, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as('david')
  const alex = as('alex')
  const sam = as('sam')
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const teamId = ((await pg.query<any>(`select team_id from core.projects where id = $1`, [project])).rows[0] as { team_id: string }).team_id
  const workspaceId = ((await pg.query<any>(`select workspace_id from core.projects where id = $1`, [project])).rows[0] as { workspace_id: string }).workspace_id
  const spec = ((await pg.query<any>(`select id, version from delivery.specs where project_id = $1`, [project])).rows[0] as { id: string; version: number })
  const reviewer = (who: string, steps: string[]) => setApprovers((m, p, b) => call(owner, m, p, b), who, steps)
  await call(owner, 'PUT', `/teams/${teamId}/slack-channel`, { channel: 'anchor-cx-launches' })
  const themeId = ((await pg.query<any>(`select id from research.themes where project_id = $1 limit 1`, [project])).rows[0] as { id: string }).id
  return { pg, db, rec, mailer, env, call, owner, alex, sam, project, teamId, workspaceId, spec, themeId, reviewer }
}

const audit = async (f: Awaited<ReturnType<typeof fixture>>, verb: string) =>
  (await f.pg.query<any>(`select after from core.audit_log where entity = 'delivery.specs' and verb = $1 order by created_at`, [verb])).rows as { after: any }[]

test('published requirements lock the project: transcripts, analysis, theme edits and discarding the document are refused with one message; stories and the rest stay open', async () => {
  const f = await fixture()
  const lock = await (await f.call(f.owner, 'GET', `/projects/${f.project}/lock`)).json()
  assert.deepEqual([lock.locked, lock.permanent, lock.canReopen], [true, false, true])
  const refuse = async (res: Response) => {
    assert.equal(res.status, 409)
    const body = await res.json()
    assert.equal(body.error.code, 'project_locked')
    assert.match(body.error.message, /locked/)
    assert.match(body.error.message, /new project/)
  }
  const version = ((await f.pg.query<any>(`select version from core.projects where id = $1`, [f.project])).rows[0] as { version: number }).version
  await refuse(await f.call(f.owner, 'PUT', `/projects/${f.project}/transcripts`, { transcripts: [] }, { 'if-match': String(version) }))
  await refuse(await f.call(f.owner, 'POST', `/projects/${f.project}/analysis-runs`, {}, { 'if-match': String(version) }))
  await refuse(await f.call(f.owner, 'PATCH', `/themes/${f.themeId}`, { title: 'Renamed' }, { 'if-match': '0' }))
  await refuse(await f.call(f.owner, 'PUT', `/themes/${f.themeId}/area`, { areaId: null }))
  await refuse(await f.call(f.owner, 'DELETE', `/projects/${f.project}/priority-overrides`))
  await refuse(await f.call(f.owner, 'DELETE', `/specs/${f.spec.id}`))
  await refuse(await f.call(f.owner, 'DELETE', `/specs/${f.spec.id}?permanent=true`))
  // Still open: the board, the launch, reading everything.
  assert.equal((await f.call(f.owner, 'GET', `/projects/${f.project}/board`)).status, 200)
  assert.equal((await f.call(f.owner, 'GET', `/projects/${f.project}/transcripts`)).status, 200)
  assert.equal((await f.call(f.owner, 'GET', `/projects/${f.project}/themes`)).status, 200)
})

test('who may return published requirements to draft: a workspace owner or the final decision holder; a reason is required; the change is audited and the project opens up', async () => {
  const f = await fixture()
  await f.reviewer('sam', ['final_decision'])
  assert.equal((await f.call(f.alex, 'POST', `/specs/${f.spec.id}/reopen`, { reason: 'A missed requirement.' })).status, 403, 'an editor who is neither')
  assert.equal((await (await f.call(f.alex, 'GET', `/projects/${f.project}/lock`)).json()).canReopen, false)
  assert.equal((await (await f.call(f.sam, 'GET', `/projects/${f.project}/lock`)).json()).canReopen, true, 'the person with the final decision is offered it')
  assert.equal((await f.call(f.sam, 'POST', `/specs/${f.spec.id}/reopen`, { reason: '' })).status, 422, 'a reason is required')

  const res = await f.call(f.sam, 'POST', `/specs/${f.spec.id}/reopen`, { reason: 'Legal asked for one more requirement.' })
  assert.equal(res.status, 200)
  const doc = await res.json()
  assert.equal(doc.status, 'draft')
  assert.equal(doc.publishedAt, null)
  assert.equal(doc.canPublish, true, 'every step is still approved')
  const logged = await audit(f, 'reopened')
  assert.equal(logged.length, 1)
  assert.equal(logged[0].after.reason, 'Legal asked for one more requirement.')
  assert.equal((await (await f.call(f.owner, 'GET', `/projects/${f.project}/lock`)).json()).locked, false)
  assert.equal((await f.call(f.owner, 'PATCH', `/themes/${f.themeId}`, { title: 'Renamed while a draft' }, { 'if-match': '0' })).status, 200, 'the project is open again')
  assert.equal((await f.call(f.sam, 'POST', `/specs/${f.spec.id}/reopen`, { reason: 'Again?' })).status, 409, 'it is a draft now')
})

test('publishing again after a reopen brings the board in line without duplicating stories or touching work already done', async () => {
  const f = await fixture()
  const stories = async () => (await f.pg.query<any>(`select count(*)::int n from delivery.stories where spec_id = $1`, [f.spec.id])).rows[0].n as number
  const before = await stories()
  const working = async () => (await f.pg.query<any>(`select count(*)::int n from delivery.stories where spec_id = $1 and status = 'in_progress'`, [f.spec.id])).rows[0].n as number
  await f.pg.query(`update delivery.stories set status = 'in_progress' where id = (select id from delivery.stories where spec_id = $1 and kind = 'requirement' order by key limit 1)`, [f.spec.id])
  const workingBefore = await working()
  assert.equal((await f.call(f.owner, 'POST', `/specs/${f.spec.id}/reopen`, { reason: 'Wording fixes.' })).status, 200)
  const draft = await (await f.call(f.owner, 'GET', `/specs/${f.spec.id}`)).json()
  const again = await f.call(f.owner, 'POST', `/specs/${f.spec.id}/publish`, undefined, { 'if-match': String(draft.version) })
  assert.equal(again.status, 201)
  assert.equal(await stories(), before, 'no duplicates')
  assert.equal(await working(), workingBefore, 'work in progress is kept')
  assert.equal((await audit(f, 'published_again')).length, 1)
  assert.equal((await (await f.call(f.owner, 'GET', `/projects/${f.project}/lock`)).json()).locked, true, 'locked again')
})

test('the first real Jira ticket makes the lock permanent: nobody can reopen; a simulated ticket pushes nothing and changes nothing', async () => {
  const f = await fixture()
  const story = ((await f.pg.query<any>(`select id, key from delivery.stories where spec_id = $1 and kind = 'requirement' order by key limit 1`, [f.spec.id])).rows[0]) as { id: string; key: string }
  const ticket = (simulated: boolean, key: string) =>
    f.pg.query(
      `insert into delivery.story_tickets (workspace_id, spec_id, story_id, story_key, jira_key, project, issue_type, summary, priority, simulated) values ($1, $2, $3, $4, $5, 'PLAT', 'Story', 'x', 'High', $6)`,
      [f.workspaceId, f.spec.id, story.id, story.key, key, simulated],
    )
  await ticket(true, 'PLAT-1')
  assert.equal((await (await f.call(f.owner, 'GET', `/projects/${f.project}/lock`)).json()).permanent, false, 'simulated does not count')
  await f.pg.query(`delete from delivery.story_tickets`)
  await ticket(false, 'PLAT-2')
  const lock = await (await f.call(f.owner, 'GET', `/projects/${f.project}/lock`)).json()
  assert.deepEqual([lock.locked, lock.permanent, lock.canReopen], [true, true, false])
  const res = await f.call(f.owner, 'POST', `/specs/${f.spec.id}/reopen`, { reason: 'Please?' })
  assert.equal(res.status, 409)
  assert.equal((await res.json()).error.code, 'tickets_exist')
  assert.match((await (await f.call(f.owner, 'PUT', `/projects/${f.project}/transcripts`, { transcripts: [] }, { 'if-match': '1' })).json()).error.message, /locked for good/)
})

test('a reopen tells the launch once: those who were asked are emailed, the Slack message is edited in place, the sweep stays quiet until it is published again; the first real ticket tells the owner once', async () => {
  const f = await fixture()
  await f.reviewer('alex', ['legal', 'sales', 'documentation'])
  await f.reviewer('sam', ['marketing'])
  await f.reviewer('david', ['product_leadership', 'final_decision'])
  await f.call(f.alex, 'POST', `/projects/${f.project}/storyboard/generate`)
  const userId = ((await f.pg.query<any>(`select id from core.users where email = 'alex@acme-research.com'`)).rows[0] as { id: string }).id
  const ctx = (await contextForUser(f.db, f.workspaceId, userId))!
  const deps = { db: f.db, env: f.env, mailer: f.mailer, slack: f.rec.slack }
  await afterRequirements(deps, ctx, f.project) // asks for the answers
  const posts = f.rec.posts.length
  f.mailer.sent.length = 0

  assert.equal((await f.call(f.owner, 'POST', `/specs/${f.spec.id}/reopen`, { reason: 'A requirement was missed.' })).status, 200)
  const told = f.mailer.sent.filter((m) => /were reopened/.test(m.subject))
  assert.deepEqual(told.map((m) => m.to).sort(), ['alex@acme-research.com', 'sam@acme-research.com'], 'everyone asked, except the person who reopened it')
  assert.match(told[0].text, /Why: A requirement was missed\./)
  assert.equal(f.rec.posts.length, posts, 'Slack gets no new post')
  assert.ok(f.rec.updates.some((u) => /Requirements reopened/.test(u.text)), 'the requirements message is edited')
  assert.ok(f.rec.updates.some((u) => /Requirements reopened for changes/.test(u.text) && /Where it stands/.test(u.text)), 'and so is the status')

  // The hourly job asks and chases nobody while the requirements are in draft.
  f.mailer.sent.length = 0
  await f.call(f.owner, 'GET', '/launches')
  assert.equal(f.mailer.sent.filter((m) => /confirm your answer|waiting|still waiting/.test(m.subject)).length, 0)

  // The first real ticket: the audit log and the launch's owner (once).
  await f.pg.query(`update delivery.specs set status = 'published', published_at = now() where id = $1`, [f.spec.id])
  const story = ((await f.pg.query<any>(`select id, key from delivery.stories where spec_id = $1 and kind = 'requirement' order by key limit 1`, [f.spec.id])).rows[0]) as { id: string; key: string }
  await f.pg.query(
    `insert into delivery.story_tickets (workspace_id, spec_id, story_id, story_key, jira_key, project, issue_type, summary, priority, simulated) values ($1, $2, $3, $4, 'PLAT-9', 'PLAT', 'Story', 'x', 'High', false)`,
    [f.workspaceId, f.spec.id, story.id, story.key],
  )
  f.mailer.sent.length = 0
  const owner = (await contextForUser(f.db, f.workspaceId, ((await f.pg.query<any>(`select id from core.users where email = 'david@acme-research.com'`)).rows[0] as { id: string }).id))!
  await afterFirstTicket(deps, owner, story.id, false)
  assert.equal((await audit(f, 'locked_permanently')).length, 1)
  const lockedMail = f.mailer.sent.filter((m) => /are locked/.test(m.subject))
  assert.deepEqual(lockedMail.map((m) => m.to), ['alex@acme-research.com'], 'the launch owner, once')
  const second = ((await f.pg.query<any>(`select id, key from delivery.stories where spec_id = $1 and kind = 'requirement' order by key offset 1 limit 1`, [f.spec.id])).rows[0]) as { id: string; key: string }
  await f.pg.query(
    `insert into delivery.story_tickets (workspace_id, spec_id, story_id, story_key, jira_key, project, issue_type, summary, priority, simulated) values ($1, $2, $3, $4, 'PLAT-10', 'PLAT', 'Story', 'y', 'High', false)`,
    [f.workspaceId, f.spec.id, second.id, second.key],
  )
  await afterFirstTicket(deps, owner, second.id, false)
  assert.equal((await audit(f, 'locked_permanently')).length, 1, 'a second ticket is not the first')
  assert.equal(f.mailer.sent.filter((m) => /are locked/.test(m.subject)).length, 1)
})

test('the draft banner: any new analysis marks a draft stale, but the warning only appears when the themes actually differ', async () => {
  // Matching is by wording, then category and head count.
  const t = (title: string, category = 'pain_point', ppl = 3) => ({ title, category, ppl })
  assert.equal(compareThemes([t('Reviews and ratings drive trust')], [t('Reviews and ratings drive trust')]), null)
  assert.equal(compareThemes([t('Reviews and ratings drive trust')], [t('Ratings and reviews drive the trust')]), null, 'reworded, same theme')
  assert.deepEqual(compareThemes([t('Reviews and ratings drive trust', 'pain_point', 3)], [t('Reviews and ratings drive trust', 'pain_point', 4)]), { added: [], removed: [], changed: ['Reviews and ratings drive trust'] })
  assert.deepEqual(compareThemes([t('Booking form is too long')], [t('Insurance cards are hard to scan')]), { added: ['Insurance cards are hard to scan'], removed: ['Booking form is too long'], changed: [] })

  const f = await fixture()
  await f.pg.query(`update delivery.specs set status = 'draft', published_at = null, stale = true where id = $1`, [f.spec.id])
  const read = async () => (await (await f.call(f.owner, 'GET', `/specs/${f.spec.id}`)).json()).themeChanges
  assert.equal(await read(), null, 'stale, but the same analysis: nothing to warn about')
  // A newer analysis whose themes differ from the ones the draft was written from.
  const run = (await f.pg.query<any>(`select run_id from research.themes where project_id = $1 limit 1`, [f.project])).rows[0].run_id as string
  await f.pg.query(`update core.agent_runs set superseded_at = now() where id = $1`, [run])
  const newRun = crypto.randomUUID()
  await f.pg.query(`insert into core.agent_runs (id, workspace_id, project_id, kind, status, provider, prompt_version, finished_at) values ($1, $2, $3, 'analysis', 'complete', 'stub', 'x', now())`, [newRun, f.workspaceId, f.project])
  const old = (await f.pg.query<any>(`select * from research.themes where project_id = $1 and run_id = $2 limit 1`, [f.project, run])).rows[0]
  const id = crypto.randomUUID()
  await f.pg.query(`insert into research.themes (id, workspace_id, project_id, run_id, title, category, stage_position, severity, description, opportunity, suggested_priority, suggested_effort, effort_note, score) values ($1, $2, $3, $4, 'Something about parking validation', $5, $6, $7, 'd', 'o', 'medium', 2, 'n', 1)`, [id, f.workspaceId, f.project, newRun, old.category, old.stage_position, old.severity])
  const changes = await read()
  assert.ok(changes, 'the themes differ, so the draft is warned')
  assert.ok(changes.added.includes('Something about parking validation'))
  assert.ok(changes.removed.length > 0)
})
