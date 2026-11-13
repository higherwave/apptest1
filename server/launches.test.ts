// Launch (slice 3): one launch per project, answered step by step by each step's reviewer; reopened by a change to the brief; reached from outside the
// team by an assigned reviewer, and by an external reviewer for their own steps only. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const TOKEN = { DEV_TOKEN: 's3cret' }
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

// The demo has David (owner), Alex (editor) and Sam (viewer), all in the default team (General). The Clinic booking project has themes and a published
// document; "New patient intake (draft)" has no themes. Each request is made as one person, with a new app so the identity cache never carries over.
async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  const as = (who?: string) => createApp({ env: { ...TOKEN, ...(who ? { DEV_USER_EMAIL: who.includes('@') ? who : `${who}@demo.signalflow.example` } : {}) }, getDb: () => db })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown, authed = true) =>
    app.request(`/api/v1${path}`, { method, headers: authed ? headers : {}, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as()
  const members = (await (await call(owner, 'GET', '/members')).json()).data as { id: string; email: string }[]
  const member = (key: string) => members.find((m) => m.email.startsWith(`${key}@`))!.id
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  const draft = ((await pg.query<any>(`select id from core.projects where name = 'New patient intake (draft)'`)).rows[0] as { id: string }).id
  const general = ((await pg.query<any>(`select id from core.teams where is_default`)).rows[0] as { id: string }).id
  const reviewer = (who: string, steps: string[], teams: 'all' | string[] = 'all', role = 'primary') => call(owner, 'POST', '/reviewers', { memberId: member(who), steps, teams, role })
  const state = (launch: any, step: string) => launch.steps.find((s: any) => s.step === step).state
  return { pg, db, as, call, owner, member, project, draft, general, reviewer, state }
}

test('a launch starts once the project has themes, one per project, by an editor of its team', async () => {
  const { as, call, project, draft } = await fixture()
  const alex = as('alex')
  const sam = as('sam')
  const none = await (await call(alex, 'GET', `/projects/${project}/launch`)).json()
  assert.deepEqual([none.launch, none.canCreate, none.whyNot], [null, true, null])
  const viewer = await (await call(sam, 'GET', `/projects/${project}/launch`)).json()
  assert.deepEqual([viewer.canCreate, /editor/.test(viewer.whyNot)], [false, true])
  assert.equal((await call(sam, 'POST', `/projects/${project}/launch`, {})).status, 403, 'a viewer cannot start one')
  const early = await (await call(alex, 'GET', `/projects/${draft}/launch`)).json()
  assert.deepEqual([early.canCreate, /themes/.test(early.whyNot)], [false, true])
  const refused = await call(alex, 'POST', `/projects/${draft}/launch`, {})
  assert.equal(refused.status, 409)
  assert.equal((await refused.json()).error.code, 'no_themes')

  const made = await call(alex, 'POST', `/projects/${project}/launch`, { name: 'Spring release', targetDate: '2026-12-01' })
  assert.equal(made.status, 201)
  const launch = await made.json()
  assert.deepEqual([launch.name, launch.targetDate, launch.projectName, launch.teamName, launch.you.kind, launch.you.canSetUp], ['Spring release', '2026-12-01', 'Clinic booking, usability round 1', 'General', 'team', true])
  assert.deepEqual(launch.steps.map((s: any) => s.step), ['product_leadership', 'sales', 'legal', 'documentation', 'marketing', 'final_decision'])
  assert.equal((await call(alex, 'POST', `/projects/${project}/launch`, {})).status, 409, 'one per project')
  assert.equal((await call(alex, 'POST', `/projects/${project}/launch`, { targetDate: 'tomorrow' })).status, 422, 'a date has to be a date')
  // The launch step is open from the themes on.
  const stage = await (await call(alex, 'GET', `/projects/${project}/stage`)).json()
  assert.equal(stage.tabs.launch.enabled, true)
  assert.equal((await (await call(alex, 'GET', `/projects/${draft}/stage`)).json()).tabs.launch.enabled, false)
  // The name defaults to the project's.
  assert.equal((await (await call(as(), 'GET', `/launches/${launch.id}`)).json()).name, 'Spring release')
})

test('a step with no reviewer shows as missing, never hidden; a step the team turned off shows as not used', async () => {
  const { as, call, owner, project, general, reviewer, state } = await fixture()
  const alex = as('alex')
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, {})).json()
  assert.equal(launch.name, 'Clinic booking, usability round 1')
  assert.equal(state(launch, 'legal'), 'missing')
  assert.equal(launch.summary.counts.missing, 5, 'every step but the final decision, with nobody set up')
  await reviewer('alex', ['legal'])
  await call(owner, 'PUT', `/teams/${general}/launch-steps`, { used: { sales: false } })
  const after = await (await call(alex, 'GET', `/launches/${launch.id}`)).json()
  assert.equal(state(after, 'legal'), 'waiting')
  assert.equal(state(after, 'sales'), 'not_used')
  assert.equal(after.summary.counts.missing, 3, 'sales is not used, legal is covered')
  assert.deepEqual(after.summary.blocking.map((b: any) => b.step).sort(), ['documentation', 'marketing', 'product_leadership'])
  assert.deepEqual(after.summary.waitingOn.map((w: any) => w.step), ['legal'])
})

test('only a step’s reviewer answers it; a plain ready needs no reason, anything else does; answers are added, never overwritten', async () => {
  const { as, call, project, reviewer, state } = await fixture()
  const alex = as('alex')
  const sam = as('sam')
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, {})).json()
  await reviewer('alex', ['legal'])
  await reviewer('sam', ['marketing'])
  const nope = await call(sam, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })
  assert.equal(nope.status, 403)
  const body = await nope.json()
  assert.equal(body.error.code, 'not_the_reviewer')
  assert.match(body.error.message, /Alex/)
  assert.equal((await call(alex, 'PUT', `/launches/${launch.id}/steps/sales`, { answer: 'ready' })).status, 403, 'and a step nobody is set up for says so')
  assert.equal((await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'go' })).status, 422, 'go is not an answer for a step')
  assert.equal((await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'changes_needed' })).status, 422, 'a reason is needed')
  const ready = await (await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })).json()
  assert.equal(state(ready, 'legal'), 'ready')
  assert.equal(ready.steps.find((s: any) => s.step === 'legal').canAnswer, true)
  assert.equal(ready.steps.find((s: any) => s.step === 'sales').canAnswer, false)
  const changed = await (await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'changes_needed', rationale: 'The consent wording is missing.' })).json()
  const legal = changed.steps.find((s: any) => s.step === 'legal')
  assert.deepEqual([legal.state, legal.answer.rationale, legal.answer.by.name, legal.earlier.length, legal.earlier[0].answer], ['changes_needed', 'The consent wording is missing.', 'Alex Rivera', 1, 'ready'])
  assert.deepEqual(changed.summary.blocking.map((b: any) => b.step).includes('legal'), true)
  // A viewer of the team can still be a reviewer, and only for their step.
  assert.equal((await call(sam, 'PUT', `/launches/${launch.id}/steps/marketing`, { answer: 'ready_with_conditions' })).status, 422)
  const marketing = await (await call(sam, 'PUT', `/launches/${launch.id}/steps/marketing`, { answer: 'ready_with_conditions', rationale: 'Needs the press page first.' })).json()
  assert.equal(state(marketing, 'marketing'), 'ready_with_conditions')
  assert.equal(marketing.you.canSetUp, false)
  assert.equal((await call(sam, 'PATCH', `/launches/${launch.id}`, { name: 'Mine' })).status, 403, 'a reviewer who is not an editor cannot change the launch')
})

test('a change to the brief reopens answers without erasing them, and the final decision keeps the steps it went past', async () => {
  const { as, call, project, reviewer, state } = await fixture()
  const alex = as('alex')
  const david = as()
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, {})).json()
  await reviewer('alex', ['legal'])
  await reviewer('david', ['final_decision', 'product_leadership'])
  await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })
  const going = await (await call(david, 'PUT', `/launches/${launch.id}/steps/final_decision`, { answer: 'go_with_conditions', rationale: 'Docs and marketing follow within a week.' })).json()
  assert.equal(going.summary.state, 'go_with_conditions')
  const final = going.steps.find((s: any) => s.step === 'final_decision').answer
  const past = final.openItems.map((i: any) => `${i.step}:${i.state}`)
  assert.ok(past.includes('product_leadership:waiting') && past.includes('sales:missing') && past.includes('documentation:missing'), past.join())
  assert.ok(!past.some((p: string) => p.startsWith('legal')), 'a step that was ready is not an open item')
  // The owner edits the brief notes: every answer given on the old brief is reopened, and still on record.
  await new Promise((r) => setTimeout(r, 15))
  const edited = await (await call(alex, 'PATCH', `/launches/${launch.id}`, { briefNotes: 'The consent flow changed on the 3rd.' })).json()
  assert.equal(edited.briefNotes, 'The consent flow changed on the 3rd.')
  assert.equal(state(edited, 'legal'), 'reopened')
  assert.equal(edited.steps.find((s: any) => s.step === 'legal').answer.answer, 'ready', 'the earlier answer is still there')
  assert.equal(edited.summary.state, 'reopened')
  assert.equal(edited.summary.counts.reopened, 1)
  // Changing only the name or the date does not change the brief.
  const renamed = await (await call(alex, 'PATCH', `/launches/${launch.id}`, { name: 'Spring', targetDate: '2026-12-05' })).json()
  assert.equal(state(renamed, 'legal'), 'reopened')
  const again = await (await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready', rationale: 'Checked the new consent flow.' })).json()
  assert.equal(state(again, 'legal'), 'ready')
  assert.equal(again.steps.find((s: any) => s.step === 'legal').earlier.length, 1)
  assert.equal(again.summary.state, 'reopened', 'the final decision was given on the old brief and is still reopened')
})

test('links: the step’s reviewer adds and removes them; only web links', async () => {
  const { as, call, project, reviewer } = await fixture()
  const alex = as('alex')
  const sam = as('sam')
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, {})).json()
  await reviewer('alex', ['legal'])
  const added = await call(alex, 'POST', `/launches/${launch.id}/steps/legal/links`, { title: 'Approved consent copy', url: 'https://docs.example.com/consent' })
  assert.equal(added.status, 201)
  const withLink = await added.json()
  const links = withLink.steps.find((s: any) => s.step === 'legal').links
  assert.deepEqual([links.length, links[0].title, links[0].addedBy], [1, 'Approved consent copy', 'Alex Rivera'])
  assert.equal((await call(alex, 'POST', `/launches/${launch.id}/steps/legal/links`, { url: 'javascript:alert(1)' })).status, 422)
  assert.equal((await call(alex, 'POST', `/launches/${launch.id}/steps/legal/links`, { url: 'not a link' })).status, 422)
  const untitled = await (await call(alex, 'POST', `/launches/${launch.id}/steps/legal/links`, { url: 'https://wiki.example.com/page' })).json()
  assert.equal(untitled.steps.find((s: any) => s.step === 'legal').links[1].title, 'wiki.example.com')
  assert.equal((await call(sam, 'POST', `/launches/${launch.id}/steps/legal/links`, { url: 'https://example.com' })).status, 403)
  assert.equal((await call(sam, 'DELETE', `/launches/${launch.id}/links/${links[0].id}`)).status, 403)
  const removed = await (await call(alex, 'DELETE', `/launches/${launch.id}/links/${links[0].id}`)).json()
  assert.equal(removed.steps.find((s: any) => s.step === 'legal').links.length, 1)
})

test('a reviewer assigned from outside the team reaches the launch by its address only; narrowest scope decides who is the reviewer', async () => {
  const { pg, as, call, owner, project, general, reviewer, state } = await fixture()
  const alex = as('alex')
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, {})).json()
  const ws = (await pg.query<any>(`select id from core.workspaces limit 1`)).rows[0].id
  const support = (await pg.query<any>(`insert into core.teams (workspace_id, name) values ($1, 'Support') returning id`, [ws])).rows[0].id
  await call(owner, 'PUT', `/teams/${support}/projects/${project}`)
  await reviewer('alex', ['legal'])              // all teams
  await reviewer('sam', ['marketing'], [general]) // General only
  // Alex is not in Support but is its legal reviewer: he opens the launch by its address, not through the project.
  const asReviewer = await call(alex, 'GET', `/launches/${launch.id}`)
  assert.equal(asReviewer.status, 200)
  const seen = await asReviewer.json()
  assert.deepEqual([seen.you.kind, seen.you.canSetUp, seen.you.steps, seen.teamName], ['reviewer', false, ['legal'], 'Support'])
  assert.equal((await call(alex, 'GET', `/projects/${project}/launch`)).status, 404, 'the project is another team’s')
  assert.equal((await call(alex, 'PATCH', `/launches/${launch.id}`, { name: 'x' })).status, 403)
  assert.equal(state(await (await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })).json(), 'legal'), 'ready')
  // Sam's marketing assignment covers General only, so the Support launch is not his.
  assert.equal((await call(as('sam'), 'GET', `/launches/${launch.id}`)).status, 404)
  assert.equal((await call(as('sam'), 'PUT', `/launches/${launch.id}/steps/marketing`, { answer: 'ready' })).status, 404)
  // A Support-only legal reviewer takes the step over from the all-teams one, for Support only.
  await reviewer('sam', ['legal'], [support])
  assert.equal((await call(as('sam'), 'GET', `/launches/${launch.id}`)).status, 200)
  assert.equal((await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })).status, 404, 'Alex is no longer a reviewer for any step of this launch')
  // Leaders see it, read-only.
  const leader = await (await call(owner, 'GET', `/launches/${launch.id}`)).json()
  assert.equal(leader.you.canSetUp, false)
  assert.equal(leader.steps.every((s: any) => s.canAnswer === false), true)
})

test('an external reviewer sees only their own steps and the brief notes, and the list holds only their launches', async () => {
  const { pg, as, call, owner, member, project, general, reviewer } = await fixture()
  const alex = as('alex')
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, { briefNotes: 'What outside counsel needs: the consent wording on page 3.' })).json()
  await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' }) // refused: no reviewer yet
  const counsel = 'counsel@lawfirm.example'
  const made = await (await call(owner, 'POST', '/members', { email: counsel, role: 'viewer', external: true })).json()
  assert.equal((await call(owner, 'POST', '/reviewers', { memberId: made.id, steps: ['legal'], teams: [general], role: 'primary' })).status, 201)
  await reviewer('alex', ['marketing'])
  const them = as(counsel)
  const mine = await (await call(them, 'GET', '/launches')).json()
  assert.deepEqual([mine.data.length, mine.data[0].id, mine.data[0].yourSteps, mine.data[0].waitingOnYou], [1, launch.id, ['legal'], ['legal']])
  const view = await (await call(them, 'GET', `/launches/${launch.id}`)).json()
  assert.deepEqual(view.steps.map((s: any) => s.step), ['legal'], 'only their own section')
  assert.equal(view.briefNotes.startsWith('What outside counsel needs'), true)
  assert.deepEqual([view.brief.published, view.brief.requirements.length, view.brief.problem], [false, 0, null], 'no requirements or research')
  assert.deepEqual(Object.values(view.summary.counts), [0, 0, 0, 0, 0, 0, 0], 'no picture of the other sections')
  assert.equal(view.you.kind, 'external')
  const answered = await call(them, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready_with_conditions', rationale: 'Subject to the consent wording on page 3.' })
  assert.equal(answered.status, 200)
  assert.equal((await call(them, 'PUT', `/launches/${launch.id}/steps/marketing`, { answer: 'ready' })).status, 403)
  // Everything else is closed to them.
  for (const path of ['/projects', `/projects/${project}/launch`, '/measure']) assert.equal((await call(them, 'GET', path)).status, 403, path)
  // Another team's launch is not theirs.
  const ws = (await pg.query<any>(`select id from core.workspaces limit 1`)).rows[0].id
  const other = (await pg.query<any>(`insert into core.teams (workspace_id, name) values ($1, 'Other') returning id`, [ws])).rows[0].id
  await call(owner, 'PUT', `/teams/${other}/projects/${project}`)
  assert.equal((await call(them, 'GET', `/launches/${launch.id}`)).status, 404)
  void member
})

test('the list shows each launch to those who may see it; the read-only demo viewer sees all and can change nothing', async () => {
  const { as, call, project, reviewer } = await fixture()
  const alex = as('alex')
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, {})).json()
  await reviewer('alex', ['legal'])
  const list = (await (await call(alex, 'GET', '/launches')).json()).data
  assert.deepEqual([list.length, list[0].yourSteps, list[0].waitingOnYou, list[0].state], [1, ['legal'], ['legal'], 'preparing'])
  const visitor = as()
  const seen = await call(visitor, 'GET', '/launches', undefined, false)
  assert.equal(seen.status, 200)
  assert.equal((await seen.json()).data.length, 1)
  const detail = await (await call(visitor, 'GET', `/launches/${launch.id}`, undefined, false)).json()
  assert.deepEqual([detail.you.kind, detail.you.canSetUp, detail.steps.every((s: any) => !s.canAnswer)], ['visitor', false, true])
  assert.equal((await call(visitor, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' }, false)).status, 401)
})

test('every change to a launch is in the audit log, under its own filter', async () => {
  const { as, call, owner, project, reviewer } = await fixture()
  const alex = as('alex')
  const launch = await (await call(alex, 'POST', `/projects/${project}/launch`, {})).json()
  await reviewer('alex', ['legal'])
  await call(alex, 'PUT', `/launches/${launch.id}/steps/legal`, { answer: 'ready' })
  await call(alex, 'POST', `/launches/${launch.id}/steps/legal/links`, { url: 'https://example.com/doc' })
  await call(alex, 'PATCH', `/launches/${launch.id}`, { briefNotes: 'New notes' })
  const log = await (await call(owner, 'GET', '/audit?group=launches')).json()
  const seen = log.data.map((e: any) => `${e.entity}:${e.verb}`).sort()
  assert.deepEqual(seen, ['delivery.launch_answers:answered', 'delivery.launch_links:added', 'delivery.launches:brief changed', 'delivery.launches:created'])
})
