// Launch reviewers (slice 1): standing assignments, which steps a team uses, the coverage grid, and external members. Run with: npm run test:api
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

// The demo has David (owner), Alex (editor) and Sam (viewer). Each request is made as one of them; a new app per person, so the 60-second
// identity cache never carries a change of role across.
async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  const as = (who?: string) => createApp({ env: { ...TOKEN, ...(who ? { DEV_USER_EMAIL: who.includes('@') ? who : `${who}@demo.signalflow.example` } : {}) }, getDb: () => db })
  const call = (app: ReturnType<typeof createApp>, method: string, path: string, body?: unknown) =>
    app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const owner = as()
  const members = (await (await call(owner, 'GET', '/members')).json()).data as { id: string; email: string; role: string }[]
  const member = (key: string) => members.find((m) => m.email.startsWith(`${key}@`))!.id
  const team = async (name: string) => (await (await call(owner, 'POST', '/teams', { name })).json()).id as string
  const cell = (overview: any, teamName: string, step: string) => overview.teams.find((t: any) => t.name === teamName).steps.find((s: any) => s.step === step)
  return { pg, db, as, call, owner, member, team, cell }
}

test('owners set up reviewers once: the coverage grid shows covered, gap and not used, and the narrowest scope wins', async () => {
  const { call, owner, member, team, cell } = await fixture()
  const payments = await team('Payments')
  const alex = member('alex')
  const sam = member('sam')

  let r = await call(owner, 'POST', '/reviewers', { memberId: alex, steps: ['legal'], teams: 'all', role: 'primary' })
  assert.equal(r.status, 201)
  let o = await r.json()
  assert.deepEqual(o.steps.map((s: any) => s.key), ['product_leadership', 'sales', 'legal', 'documentation', 'marketing', 'final_decision'])
  assert.equal(cell(o, 'General', 'legal').state, 'covered')
  assert.equal(cell(o, 'Payments', 'legal').state, 'covered', 'all teams includes a team made before and after')
  assert.equal(cell(o, 'Payments', 'sales').state, 'gap', 'a step nobody covers is a gap, never hidden')
  assert.equal(cell(o, 'Payments', 'final_decision').state, 'gap')

  // A reviewer for one team only.
  o = await (await call(owner, 'POST', '/reviewers', { memberId: sam, steps: ['marketing'], teams: [payments], role: 'primary' })).json()
  assert.equal(cell(o, 'Payments', 'marketing').state, 'covered')
  assert.equal(cell(o, 'General', 'marketing').state, 'gap', 'the other teams are not covered')

  // A team that does not use a step: not used (greyed), and the others stay gaps.
  o = await (await call(owner, 'PUT', `/teams/${payments}/launch-steps`, { used: { sales: false } })).json()
  assert.equal(cell(o, 'Payments', 'sales').state, 'not_used')
  assert.equal(cell(o, 'General', 'sales').state, 'gap')
  assert.deepEqual(o.teams.find((t: any) => t.name === 'Payments').stepsOff, ['sales'])
  assert.equal((await call(owner, 'PUT', `/teams/${payments}/launch-steps`, { used: { final_decision: false } })).status, 422, 'the final decision always applies')
  o = await (await call(owner, 'PUT', `/teams/${payments}/launch-steps`, { used: { sales: true } })).json()
  assert.equal(cell(o, 'Payments', 'sales').state, 'gap', 'turned back on, a step nobody covers shows as a gap again')

  // The narrowest scope wins: a Payments-only legal primary beats the all-teams one there, and only there.
  o = await (await call(owner, 'POST', '/reviewers', { memberId: sam, steps: ['legal'], teams: [payments], role: 'primary' })).json()
  assert.equal(cell(o, 'Payments', 'legal').primary[0].email.split('@')[0], 'sam')
  assert.equal(cell(o, 'General', 'legal').primary[0].email.split('@')[0], 'alex')
})

test('one primary per step and team; an alternate stands in, and an alternate alone is still a gap', async () => {
  const { call, owner, member, team, cell } = await fixture()
  const payments = await team('Payments')
  await call(owner, 'POST', '/reviewers', { memberId: member('alex'), steps: ['documentation'], teams: [payments], role: 'primary' })
  const taken = await call(owner, 'POST', '/reviewers', { memberId: member('sam'), steps: ['documentation'], teams: [payments], role: 'primary' })
  assert.equal(taken.status, 409)
  assert.equal((await taken.json()).error.code, 'primary_taken')
  let o = await (await call(owner, 'POST', '/reviewers', { memberId: member('sam'), steps: ['documentation'], teams: [payments], role: 'alternate' })).json()
  const docs = cell(o, 'Payments', 'documentation')
  assert.deepEqual([docs.state, docs.primary.length, docs.alternate.length], ['covered', 1, 1])
  // Taking the primary away leaves an alternate alone: not coverage.
  const primary = o.assignments.find((a: any) => a.role === 'primary' && a.step === 'documentation')
  o = await (await call(owner, 'DELETE', `/reviewers/${primary.id}`)).json()
  assert.equal(cell(o, 'Payments', 'documentation').state, 'gap')
  // Setting the same person up again with a new role changes the role, it does not add a second row.
  o = await (await call(owner, 'POST', '/reviewers', { memberId: member('sam'), steps: ['documentation'], teams: [payments], role: 'primary' })).json()
  assert.equal(o.assignments.filter((a: any) => a.step === 'documentation').length, 1)
  assert.equal(cell(o, 'Payments', 'documentation').state, 'covered')
})

test('only owners can see or change reviewers and steps', async () => {
  const { as, call, member, team } = await fixture()
  const payments = await team('Payments')
  for (const who of ['alex', 'sam']) {
    const app = as(who)
    assert.equal((await call(app, 'GET', '/reviewers')).status, 403, `${who} cannot read`)
    assert.equal((await call(app, 'POST', '/reviewers', { memberId: member('alex'), steps: ['legal'], teams: 'all', role: 'primary' })).status, 403)
    assert.equal((await call(app, 'PUT', `/teams/${payments}/launch-steps`, { used: { sales: false } })).status, 403)
    assert.equal((await call(app, 'DELETE', `/reviewers/${payments}`)).status, 403)
  }
})

test('bad input is refused: no step, an unknown team, an unknown member', async () => {
  const { call, owner, member } = await fixture()
  const none = '00000000-0000-4000-8000-000000000000'
  assert.equal((await call(owner, 'POST', '/reviewers', { memberId: member('alex'), steps: [], teams: 'all', role: 'primary' })).status, 422)
  assert.equal((await call(owner, 'POST', '/reviewers', { memberId: member('alex'), steps: ['legal'], teams: [none], role: 'primary' })).status, 404)
  assert.equal((await call(owner, 'POST', '/reviewers', { memberId: none, steps: ['legal'], teams: 'all', role: 'primary' })).status, 404)
  assert.equal((await call(owner, 'POST', '/reviewers', { memberId: member('alex'), steps: ['nonsense'], teams: 'all', role: 'primary' })).status, 422)
  assert.equal((await call(owner, 'PUT', `/teams/${none}/launch-steps`, { used: { sales: false } })).status, 404)
})

test('an external member is a viewer, covers named teams only, and is refused everywhere but their own details', async () => {
  const { as, call, owner, member, team } = await fixture()
  const payments = await team('Payments')
  const counsel = 'counsel@lawfirm.example'
  const bad = await call(owner, 'POST', '/members', { email: counsel, role: 'editor', external: true })
  assert.equal(bad.status, 409)
  assert.equal((await bad.json()).error.code, 'external_needs_viewer')
  const made = await (await call(owner, 'POST', '/members', { email: counsel, role: 'viewer', external: true })).json()
  assert.equal(made.external, true)
  assert.equal((await call(owner, 'POST', '/reviewers', { memberId: made.id, steps: ['legal'], teams: 'all', role: 'primary' })).status, 422, 'not all teams')
  assert.equal((await call(owner, 'POST', '/reviewers', { memberId: made.id, steps: ['legal'], teams: [payments], role: 'primary' })).status, 201)

  // As that person: their own details, and nothing else yet.
  const them = as(counsel)
  const me = await call(them, 'GET', '/me')
  assert.equal(me.status, 200)
  assert.equal((await me.json()).external, true)
  for (const path of ['/projects', '/members', '/insights/themes', '/reviewers', '/teams']) {
    const res = await call(them, 'GET', path)
    assert.equal(res.status, 403, `${path} is refused`)
    assert.equal((await res.json()).error.code, 'external_member')
  }
  assert.equal((await call(them, 'POST', '/teams', { name: 'Sneaky' })).status, 403)

  // An editor cannot be marked external; marking a viewer external ends their all-teams assignments.
  assert.equal((await call(owner, 'PATCH', `/members/${member('alex')}`, { external: true })).status, 409)
  await call(owner, 'POST', '/reviewers', { memberId: member('sam'), steps: ['sales'], teams: 'all', role: 'alternate' })
  const sam = await (await call(owner, 'PATCH', `/members/${member('sam')}`, { external: true })).json()
  assert.equal(sam.external, true)
  const after = await (await call(owner, 'GET', '/reviewers')).json()
  assert.equal(after.assignments.filter((a: any) => a.email.startsWith('sam@') && a.teamId === null).length, 0, 'the all-teams assignment ended')
  // An external member cannot be made an editor while external, and can be made internal again.
  assert.equal((await call(owner, 'PATCH', `/members/${made.id}`, { role: 'editor' })).status, 409)
  assert.equal((await (await call(owner, 'PATCH', `/members/${made.id}`, { external: false })).json()).external, false)
})

test('removing a member ends their assignments, so the step shows as a gap', async () => {
  const { call, owner, member, cell } = await fixture()
  await call(owner, 'POST', '/reviewers', { memberId: member('alex'), steps: ['legal', 'marketing'], teams: 'all', role: 'primary' })
  assert.equal(cell(await (await call(owner, 'GET', '/reviewers')).json(), 'General', 'legal').state, 'covered')
  assert.equal((await call(owner, 'DELETE', `/members/${member('alex')}`)).status, 204)
  const o = await (await call(owner, 'GET', '/reviewers')).json()
  assert.equal(o.assignments.length, 0)
  assert.equal(cell(o, 'General', 'legal').state, 'gap')
})

test('every change is in the audit log, under its own filter', async () => {
  const { call, owner, member, team } = await fixture()
  const payments = await team('Payments')
  await call(owner, 'POST', '/reviewers', { memberId: member('alex'), steps: ['legal'], teams: [payments], role: 'primary' })
  await call(owner, 'PUT', `/teams/${payments}/launch-steps`, { used: { sales: false } })
  const log = await (await call(owner, 'GET', '/audit?group=reviewers')).json()
  const verbs = log.data.map((e: any) => `${e.entity}:${e.verb}`).sort()
  assert.deepEqual(verbs, ['core.reviewer_assignments:added', 'core.team_launch_steps:launch steps changed'])
  assert.equal(log.data.find((e: any) => e.verb === 'added').after.teams, 'Payments')
})
