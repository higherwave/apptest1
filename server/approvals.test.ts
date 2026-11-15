// Launch approvals: who approves each step for the workspace and per team, which steps a team uses, gaps, and external members. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase, setApprovers } from './test-utils.js'

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
  const person = async (key: string) => ((await (await call(owner, 'GET', '/approvals')).json()).people as { userId: string; email: string }[]).find((p) => p.email.startsWith(`${key}@`))!.userId
  const save = (step: string, body: unknown) => call(owner, 'PUT', `/approvals/steps/${step}`, body)
  const team = async (name: string) => (await (await call(owner, 'POST', '/teams', { name })).json()).id as string
  // One cell of the grid: what a team ends up with for a step.
  const cell = (o: any, teamName: string, step: string) => o.steps.find((s: any) => s.key === step).teams[o.teams.findIndex((t: any) => t.name === teamName)]
  const grid = async () => (await call(owner, 'GET', '/approvals')).json()
  const apply = (who: string, steps: string[], role: 'primary' | 'alternate' = 'primary', teams: 'all' | string[] = 'all') => setApprovers((m, p, b) => call(owner, m, p, b), who, steps, role, teams)
  return { pg, db, as, call, owner, member, person, save, team, cell, grid, apply }
}

test('owners set up approvers once: the grid shows covered, gap and not used, and a team’s own approver beats the workspace’s', async () => {
  const { owner, call, grid, apply, save, team, cell, person } = await fixture()
  const payments = await team('Payments')
  assert.equal((await apply('alex', ['legal'])).status, 200)
  let o = await grid()
  assert.deepEqual(o.steps.map((s: any) => s.key), ['product_leadership', 'sales', 'legal', 'documentation', 'marketing', 'final_decision'])
  assert.deepEqual(o.teams.map((t: any) => t.name).sort(), ['General', 'Payments'])
  assert.equal(cell(o, 'General', 'legal').state, 'covered')
  assert.equal(cell(o, 'Payments', 'legal').state, 'covered', 'the workspace approver covers a team made before or after')
  assert.equal(cell(o, 'Payments', 'sales').state, 'gap', 'a step nobody approves is a gap, never hidden')
  assert.equal(o.gaps, 10, 'five steps in each of the two teams still have nobody')

  // A team's own approver for a step the workspace has nobody for.
  assert.equal((await apply('sam', ['marketing'], 'primary', [payments])).status, 200)
  o = await grid()
  assert.deepEqual([cell(o, 'Payments', 'marketing').state, cell(o, 'Payments', 'marketing').mode], ['covered', 'custom'])
  assert.equal(cell(o, 'General', 'marketing').state, 'gap', 'the other teams are not covered')

  // A team that does not use a step: not used, and the other team stays a gap.
  assert.equal((await save('sales', { approver: null, backup: null, teams: { [payments]: { mode: 'off' } } })).status, 200)
  o = await grid()
  assert.deepEqual([cell(o, 'Payments', 'sales').state, cell(o, 'Payments', 'sales').mode], ['not_used', 'off'])
  assert.equal(cell(o, 'General', 'sales').state, 'gap')
  const finalOff = await save('final_decision', { approver: null, backup: null, teams: { [payments]: { mode: 'off' } } })
  assert.equal(finalOff.status, 422, 'the final decision is always used')
  assert.equal((await finalOff.json()).error.code, 'bad_step')
  // Turned back on, a step nobody approves is a gap again.
  await save('sales', { approver: null, backup: null, teams: {} })
  assert.equal(cell(await grid(), 'Payments', 'sales').state, 'gap')

  // A team's own legal approver beats the workspace's there, and only there.
  await apply('sam', ['legal'], 'primary', [payments])
  o = await grid()
  assert.equal(cell(o, 'Payments', 'legal').effective.email.split('@')[0], 'sam')
  assert.equal(cell(o, 'General', 'legal').effective.email.split('@')[0], 'alex')
  void owner; void call; void person
})

test('a team with only a backup of its own still uses the workspace approver', async () => {
  const { grid, apply, team, cell } = await fixture()
  const payments = await team('Payments')
  await apply('alex', ['documentation'])
  // A backup alone for the team cannot be saved (the team’s own setting needs its approver), so the team keeps using the workspace’s.
  const res = await apply('sam', ['documentation'], 'alternate', [payments])
  assert.equal(res.status, 422)
  assert.equal((await res.json()).error.code, 'needs_approver')
  assert.equal(cell(await grid(), 'Payments', 'documentation').mode, 'default')
})

test('one approver and one backup per step, different people; saving a step replaces what it had, all or nothing', async () => {
  const { call, owner, grid, apply, save, person, team, cell } = await fixture()
  const payments = await team('Payments')
  await apply('alex', ['documentation'])
  await apply('sam', ['documentation'], 'alternate')
  let o = await grid()
  const docs = o.steps.find((s: any) => s.key === 'documentation')
  assert.deepEqual([docs.approver.email.split('@')[0], docs.backup.email.split('@')[0]], ['alex', 'sam'])
  // The same person cannot be both.
  const alex = await person('alex')
  const same = await save('documentation', { approver: alex, backup: alex, teams: {} })
  assert.equal(same.status, 422)
  assert.equal((await same.json()).error.code, 'same_person')
  // A backup needs an approver.
  assert.equal((await save('documentation', { approver: null, backup: alex, teams: {} })).status, 422)
  // A refused save changes nothing.
  o = await grid()
  assert.equal(o.steps.find((s: any) => s.key === 'documentation').approver.email.split('@')[0], 'alex')
  // Replacing: the new approver, no backup, and a team of its own.
  const sam = await person('sam')
  await save('documentation', { approver: sam, backup: null, teams: { [payments]: { mode: 'custom', approver: alex, backup: sam } } })
  o = await grid()
  const after = o.steps.find((s: any) => s.key === 'documentation')
  assert.deepEqual([after.approver.email.split('@')[0], after.backup], ['sam', null])
  assert.deepEqual([cell(o, 'Payments', 'documentation').approver.email.split('@')[0], cell(o, 'Payments', 'documentation').backup.email.split('@')[0]], ['alex', 'sam'])
  void call; void owner
})

test('only owners can see or change approvals', async () => {
  const { as, call, person, team } = await fixture()
  const payments = await team('Payments')
  const alex = await person('alex')
  for (const who of ['alex', 'sam']) {
    const app = as(who)
    assert.equal((await call(app, 'GET', '/approvals')).status, 403, `${who} cannot read`)
    assert.equal((await call(app, 'PUT', '/approvals/steps/legal', { approver: alex, backup: null, teams: { [payments]: { mode: 'off' } } })).status, 403)
    assert.equal((await call(app, 'PUT', `/approvals/people/${alex}`, { unavailable: true })).status, 403)
  }
})

test('bad input is refused: an unknown step, team or person', async () => {
  const { save, person } = await fixture()
  const none = '00000000-0000-4000-8000-000000000000'
  const alex = await person('alex')
  assert.equal((await save('nonsense', { approver: alex, backup: null, teams: {} })).status, 422)
  assert.equal((await save('legal', { approver: alex, backup: null, teams: { [none]: { mode: 'off' } } })).status, 404)
  assert.equal((await save('legal', { approver: none, backup: null, teams: {} })).status, 404)
  assert.equal((await save('legal', { approver: 'not-an-id', backup: null, teams: {} })).status, 422)
})

test('an external person is a viewer, can approve for a team only, and is refused everywhere but their own details', async () => {
  const { as, call, owner, member, person, save, team, grid, cell } = await fixture()
  const payments = await team('Payments')
  const counsel = 'counsel@lawfirm.example'
  const bad = await call(owner, 'POST', '/members', { email: counsel, role: 'editor', external: true })
  assert.equal(bad.status, 409)
  assert.equal((await bad.json()).error.code, 'external_needs_viewer')
  const made = await (await call(owner, 'POST', '/members', { email: counsel, role: 'viewer', external: true })).json()
  assert.equal(made.external, true)
  const them0 = await person('counsel')
  const w = await save('legal', { approver: them0, backup: null, teams: {} })
  assert.equal(w.status, 422, 'not for the whole workspace')
  assert.equal((await w.json()).error.code, 'external_all_teams')
  const b = await save('legal', { approver: await person('alex'), backup: them0, teams: {} })
  assert.equal(b.status, 422, 'nor as the workspace backup')
  // As a team's own approver they are fine.
  assert.equal((await save('legal', { approver: await person('alex'), backup: null, teams: { [payments]: { mode: 'custom', approver: them0, backup: null } } })).status, 200)
  const o = await grid()
  assert.equal(cell(o, 'Payments', 'legal').effective.external, true)
  assert.equal(o.people.find((p: any) => p.email === counsel).external, true)

  // As that person: their own details, and nothing else yet.
  const them = as(counsel)
  const me = await call(them, 'GET', '/me')
  assert.equal(me.status, 200)
  assert.equal((await me.json()).external, true)
  for (const path of ['/projects', '/members', '/insights/themes', '/approvals', '/teams']) {
    const res = await call(them, 'GET', path)
    assert.equal(res.status, 403, `${path} is refused`)
    assert.equal((await res.json()).error.code, 'external_member')
  }
  assert.equal((await call(them, 'POST', '/teams', { name: 'Sneaky' })).status, 403)

  // An editor cannot be marked external; marking a viewer external ends their workspace-wide assignments.
  assert.equal((await call(owner, 'PATCH', `/members/${member('alex')}`, { external: true })).status, 409)
  await save('sales', { approver: await person('alex'), backup: await person('sam'), teams: {} })
  const sam = await (await call(owner, 'PATCH', `/members/${member('sam')}`, { external: true })).json()
  assert.equal(sam.external, true)
  const after = await grid()
  assert.equal(after.steps.find((s: any) => s.key === 'sales').backup, null, 'the workspace-wide assignment ended')
  assert.equal((await call(owner, 'PATCH', `/members/${made.id}`, { role: 'editor' })).status, 409)
  assert.equal((await (await call(owner, 'PATCH', `/members/${made.id}`, { external: false })).json()).external, false)
})

test('removing a member ends their assignments, so the step shows as a gap', async () => {
  const { call, owner, member, apply, grid, cell } = await fixture()
  await apply('alex', ['legal', 'marketing'])
  assert.equal(cell(await grid(), 'General', 'legal').state, 'covered')
  assert.equal((await call(owner, 'DELETE', `/members/${member('alex')}`)).status, 204)
  const o = await grid()
  assert.equal(o.steps.find((s: any) => s.key === 'legal').approver, null)
  assert.equal(cell(o, 'General', 'legal').state, 'gap')
})

test('every change is in the audit log, under its own filter, as one entry per save', async () => {
  const { call, owner, apply, save, team, person } = await fixture()
  const payments = await team('Payments')
  await apply('alex', ['legal'], 'primary', [payments])
  await save('sales', { approver: null, backup: null, teams: { [payments]: { mode: 'off' } } })
  await save('sales', { approver: null, backup: null, teams: { [payments]: { mode: 'off' } } }) // nothing changed: no entry
  const log = await (await call(owner, 'GET', '/audit?group=reviewers')).json()
  const verbs = log.data.map((e: any) => `${e.entity}:${e.verb}`)
  assert.deepEqual(verbs, ['core.reviewer_assignments:approvers changed', 'core.reviewer_assignments:approvers changed'])
  const legal = log.data.find((e: any) => e.after.step === 'legal')
  assert.equal(legal.after.teams.Payments.approver.endsWith('@demo.signalflow.example'), true)
  void person
})
