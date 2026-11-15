// Teams as the Admin panel saves them: create with people and a channel, one atomic save of name, channel, people and moved projects, gaps, and sign-in groups.
// Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { createDemoDatabase, setApprovers } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

async function fixture(env: Record<string, string> = {}) {
  const { pglite: pg, db } = await createDemoDatabase()
  const owner = createApp({ env: { DEV_TOKEN: 's3cret', ...env }, getDb: () => db })
  const call = (method: string, path: string, body?: unknown) => owner.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const members = (await (await call('GET', '/members')).json()).data as { id: string; email: string }[]
  const member = (key: string) => members.find((m) => m.email.startsWith(`${key}@`))!.id
  const teams = async () => (await (await call('GET', '/teams')).json()).data as any[]
  const general = ((await pg.query<any>(`select id from core.teams where is_default`)).rows[0] as { id: string }).id
  const project = ((await pg.query<any>(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0] as { id: string }).id
  return { pg, call, member, teams, general, project }
}

test('a team is made with its channel and people in one go, or not at all', async () => {
  const { call, member, teams } = await fixture()
  const res = await call('POST', '/teams', { name: 'Growth', slackChannel: '#Growth-Launches', members: { [member('alex')]: 'owner', [member('sam')]: 'viewer' } })
  assert.equal(res.status, 201)
  const made = await res.json()
  assert.equal(made.slackChannel, 'growth-launches', 'the channel is cleaned')
  assert.deepEqual(made.members.map((m: any) => [m.email.split('@')[0], m.role]).sort(), [['alex', 'owner'], ['sam', 'viewer']])
  assert.equal(made.gaps, 6, 'a new team uses all six steps and nobody approves them yet')
  // A bad channel or an unknown person leaves no team behind.
  const before = (await teams()).length
  assert.equal((await call('POST', '/teams', { name: 'Ops', slackChannel: 'not a channel' })).status, 422)
  assert.equal((await call('POST', '/teams', { name: 'Ops', members: { '00000000-0000-4000-8000-000000000000': 'viewer' } })).status, 404)
  assert.equal((await call('POST', '/teams', { name: 'growth' })).status, 409, 'the name is taken, whatever its case')
  assert.equal((await teams()).length, before)
})

test('one save renames a team, sets its channel and people, and moves projects out, atomically and audited', async () => {
  const { call, member, teams, general, project } = await fixture()
  const growth = (await (await call('POST', '/teams', { name: 'Growth' })).json()).id as string
  const res = await call('PATCH', `/teams/${general}`, { name: 'Core', slackChannel: 'core-launches', members: { [member('david')]: 'owner', [member('alex')]: 'editor' }, moveProjects: { [project]: growth } })
  assert.equal(res.status, 200)
  const after = await res.json()
  assert.equal(after.name, 'Core')
  assert.equal(after.slackChannel, 'core-launches')
  assert.deepEqual(after.members.map((m: any) => m.email.split('@')[0]).sort(), ['alex', 'david'], 'sam was taken out because the team ends with exactly these people')
  assert.ok(!after.projects.some((p: any) => p.id === project))
  assert.ok((await teams()).find((t) => t.id === growth).projects.some((p: any) => p.id === project))
  const log = await (await call('GET', '/audit?group=teams')).json()
  const verbs = log.data.map((e: any) => e.verb)
  assert.ok(['renamed', 'slack_channel', 'removed', 'project_moved'].every((v) => verbs.includes(v)))
  // Clearing the channel, and leaving things out, changes only what is named.
  const cleared = await (await call('PATCH', `/teams/${general}`, { slackChannel: '' })).json()
  assert.equal(cleared.slackChannel, null)
  assert.equal(cleared.name, 'Core')
})

test('a refused save changes nothing: a taken name, a bad channel, a project of another team, an unknown person', async () => {
  const { call, member, teams, general, project } = await fixture()
  const growth = (await (await call('POST', '/teams', { name: 'Growth' })).json()).id as string
  const snapshot = JSON.stringify(await teams())
  assert.equal((await call('PATCH', `/teams/${growth}`, { name: 'General', members: { [member('alex')]: 'editor' } })).status, 409)
  assert.equal((await call('PATCH', `/teams/${growth}`, { name: 'Growth 2', slackChannel: 'No Good!' })).status, 422)
  assert.equal((await call('PATCH', `/teams/${growth}`, { name: 'Growth 2', moveProjects: { [project]: general } })).status, 404, 'the project is not this team’s')
  assert.equal((await call('PATCH', `/teams/${growth}`, { name: 'Growth 2', members: { '00000000-0000-4000-8000-000000000000': 'viewer' } })).status, 404)
  assert.equal((await call('PATCH', `/teams/${growth}`, {})).status, 422)
  assert.equal(JSON.stringify(await teams()), snapshot)
})

test('a team shows how many steps it uses that nobody approves, and a team that turned a step off does not count it', async () => {
  const { call, teams, general } = await fixture()
  const growth = (await (await call('POST', '/teams', { name: 'Growth' })).json()).id as string
  const gaps = async (id: string) => (await teams()).find((t) => t.id === id).gaps
  assert.equal(await gaps(general), 6)
  await setApprovers((m, p, b) => call(m, p, b), 'david', ['legal', 'final_decision'])
  assert.equal(await gaps(general), 4)
  await call('PUT', '/approvals/steps/sales', { approver: null, backup: null, teams: { [growth]: { mode: 'off' } } })
  assert.equal(await gaps(growth), 3, 'sales is not used there')
  assert.equal(await gaps(general), 4)
})

test('with sign-in groups deciding teams, the default team’s people can be edited here and no other team’s', async () => {
  const { call, member, general } = await fixture({ SSO_TEAM_GROUP_PREFIX: 'signalflow-' })
  const refusedNew = await call('POST', '/teams', { name: 'Growth', members: { [member('alex')]: 'editor' } })
  assert.equal(refusedNew.status, 409)
  assert.equal((await refusedNew.json()).error.code, 'managed_by_sso')
  const growth = (await (await call('POST', '/teams', { name: 'Growth' })).json()).id as string
  const refused = await call('PATCH', `/teams/${growth}`, { members: { [member('alex')]: 'editor' } })
  assert.equal(refused.status, 409)
  // A rename, a channel and the default team's people still work.
  assert.equal((await call('PATCH', `/teams/${growth}`, { name: 'Growth team', slackChannel: 'growth' })).status, 200)
  assert.equal((await call('PATCH', `/teams/${general}`, { members: { [member('david')]: 'owner' } })).status, 200)
})
