// People: a person's teams and approvals on the member list, invites with teams, one atomic save of role and teams, sign-in groups locking the teams, and what
// happens to a person's approvals when they leave. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase, setApprovers } from './test-utils.js'
import { T } from '../shared/terms.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

async function fixture(env: Record<string, string> = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  const as = (who?: string) => createApp({ env: { DEV_TOKEN: 's3cret', ...env, ...(who ? { DEV_USER_EMAIL: `${who}@demo.signalflow.example` } : {}) }, getDb: () => db })
  const owner = as()
  const call = (method: string, path: string, body?: unknown, app = owner) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const members = async () => (await (await call('GET', '/members')).json()).data as any[]
  const byEmail = async (key: string) => (await members()).find((m) => m.email.startsWith(`${key}@`))
  const team = async (name: string) => (await (await call('POST', '/teams', { name })).json()).id as string
  const general = ((await pg.query<any>(`select id from core.teams where is_default`)).rows[0] as { id: string }).id
  const approve = (who: string, steps: string[], role: 'primary' | 'alternate' = 'primary', teams: 'all' | string[] = 'all') => setApprovers((m, p, b) => call(m, p, b), who, steps, role, teams)
  return { pg, as, call, owner, members, byEmail, team, general, approve }
}

test('the member list says which teams each person is in, with their role there, and which steps they approve', async () => {
  const { byEmail, team, call, approve, general } = await fixture()
  const payments = await team('Payments')
  const alex = await byEmail('alex')
  await call('PATCH', `/members/${alex.id}`, { teams: { [general]: 'editor', [payments]: 'viewer' } })
  await approve('alex', ['legal', 'marketing'])
  await approve('alex', ['sales'], 'primary', [payments])
  await approve('david', ['documentation'])
  await approve('alex', ['documentation'], 'alternate')
  const after = await byEmail('alex')
  assert.deepEqual(after.teams.map((t: any) => [t.name, t.role]), [['General', 'editor'], ['Payments', 'viewer']], 'the default team first')
  assert.deepEqual(after.approvals.map((a: any) => [a.label, a.role, a.teamName]), [['Sales', 'approver', 'Payments'], ['Legal', 'approver', null], ['Documentation', 'backup', null], ['Marketing', 'approver', null]])
  assert.deepEqual((await byEmail('sam')).approvals, [])
})

test('inviting with teams puts the person exactly there; without them, in the default team; an external person joins none', async () => {
  const { call, team, general, members } = await fixture()
  const payments = await team('Payments')
  const made = await (await call('POST', '/members', { email: 'pat@acme-research.com', role: 'editor', teams: { [payments]: 'viewer' } })).json()
  assert.deepEqual(made.teams.map((t: any) => [t.name, t.role]), [['Payments', 'viewer']], 'the default team is not added when it was not chosen')
  const plain = await (await call('POST', '/members', { email: 'quinn@acme-research.com', role: 'viewer' })).json()
  assert.deepEqual(plain.teams.map((t: any) => t.name), ['General'])
  const outside = await (await call('POST', '/members', { email: 'counsel@lawfirm.example', role: 'viewer', external: true })).json()
  assert.equal(outside.external, true)
  assert.deepEqual(outside.teams, [], 'an external person joins no team')
  const refused = await call('POST', '/members', { email: 'lee@lawfirm.example', role: 'viewer', external: true, teams: { [general]: 'viewer' } })
  assert.equal(refused.status, 422)
  assert.equal((await refused.json()).error.code, 'external_no_teams')
  assert.equal((await call('POST', '/members', { email: 'zed@acme-research.com', role: 'viewer', teams: { '00000000-0000-4000-8000-000000000000': 'viewer' } })).status, 404)
  assert.ok((await members()).some((m) => m.email === 'pat@acme-research.com'))
})

test('one save changes a person’s role and teams together, and an audit entry says each change', async () => {
  const { call, byEmail, team, general } = await fixture()
  const payments = await team('Payments')
  const sam = await byEmail('sam')
  assert.equal(sam.role, 'viewer')
  const res = await call('PATCH', `/members/${sam.id}`, { role: 'editor', teams: { [general]: 'editor', [payments]: 'editor' } })
  assert.equal(res.status, 200)
  const after = await res.json()
  assert.equal(after.role, 'editor')
  assert.deepEqual(after.teams.map((t: any) => [t.name, t.role]), [['General', 'editor'], ['Payments', 'editor']])
  // Taking a team away is the same call.
  const less = await (await call('PATCH', `/members/${sam.id}`, { teams: { [payments]: 'viewer' } })).json()
  assert.deepEqual(less.teams.map((t: any) => [t.name, t.role]), [['Payments', 'viewer']])
  const log = await (await call('GET', '/audit?group=teams')).json()
  const verbs = log.data.map((e: any) => e.verb)
  assert.ok(verbs.includes('added') && verbs.includes('removed') && verbs.includes('role_changed'))
  // An unknown team changes nothing.
  assert.equal((await call('PATCH', `/members/${sam.id}`, { role: 'owner', teams: { '00000000-0000-4000-8000-000000000000': 'viewer' } })).status, 404)
  assert.equal((await byEmail('sam')).role, 'editor', 'a refused save changes nothing, the role included')
})

test('an external person stays a viewer in no team, and nobody can change that flag', async () => {
  const { call, general } = await fixture()
  const made = await (await call('POST', '/members', { email: 'counsel@lawfirm.example', role: 'viewer', external: true })).json()
  assert.equal((await call('PATCH', `/members/${made.id}`, { teams: { [general]: 'viewer' } })).status, 422)
  assert.equal((await call('PATCH', `/members/${made.id}`, { role: 'editor' })).status, 409)
  assert.equal((await call('PATCH', `/members/${made.id}`, { external: false })).status, 422)
})

test('with sign-in groups deciding teams, only the default team is changed by hand', async () => {
  const { call, byEmail, team, general } = await fixture({ SSO_TEAM_GROUP_PREFIX: 'signalflow-' })
  const payments = await team('Payments')
  const sam = await byEmail('sam')
  const blocked = await call('PATCH', `/members/${sam.id}`, { teams: { [general]: 'viewer', [payments]: 'viewer' } })
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).error.code, 'managed_by_sso')
  // The default team can still be edited, and a role change still works.
  const ok = await call('PATCH', `/members/${sam.id}`, { role: 'editor', teams: { [general]: 'editor' } })
  assert.equal(ok.status, 200)
})

test(`removing ${T.a('approver')} passes their steps to the ${T.backup}; ${T.a('backup')} who leaves is dropped; a team’s own ${T.approver} reverts to the workspace’s`, async () => {
  const { call, byEmail, team, approve } = await fixture()
  const payments = await team('Payments')
  await approve('alex', ['legal', 'sales'])
  await approve('sam', ['legal'], 'alternate')
  await approve('alex', ['marketing'], 'primary', [payments])
  await approve('david', ['marketing'])
  const alex = await byEmail('alex')
  assert.equal((await call('DELETE', `/members/${alex.id}`)).status, 204)
  const o = await (await call('GET', '/approvals')).json()
  const legal = o.steps.find((s: any) => s.key === 'legal')
  assert.deepEqual([legal.approver.email.split('@')[0], legal.backup], ['sam', null], `the ${T.backup} took over`)
  assert.equal(o.steps.find((s: any) => s.key === 'sales').approver, null, `a step with no ${T.backup} is a gap, never hidden`)
  const marketing = o.steps.find((s: any) => s.key === 'marketing')
  assert.equal(marketing.teams[o.teams.findIndex((t: any) => t.name === 'Payments')].mode, 'default', `the team uses the workspace’s ${T.approver} again`)
  assert.equal(marketing.approver.email.split('@')[0], 'david')
  // A backup who leaves is simply dropped.
  await approve('david', ['documentation'])
  await approve('sam', ['documentation'], 'alternate')
  const sam = await byEmail('sam')
  await call('DELETE', `/members/${sam.id}`)
  const after = await (await call('GET', '/approvals')).json()
  const docs = after.steps.find((s: any) => s.key === 'documentation')
  assert.deepEqual([docs.approver.email.split('@')[0], docs.backup], ['david', null])
  const log = await (await call('GET', '/audit?group=members')).json()
  const removed = log.data.find((e: any) => e.verb === 'removed' && e.before.email.startsWith('alex@'))
  assert.deepEqual([removed.before.approvals, removed.before.passedToBackup], [3, 1])
})
