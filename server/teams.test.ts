// Teams: who sees and changes which projects. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { createApp } from './app.js'
import { createDemoDatabase, fakeAuth } from './test-utils.js'
import { effectiveRole, scopeOf } from './teams.js'
import { teamRolesFromGroups, teamSlug } from './sso.js'
import { spendByTeam } from './ai.js'
import { composeDigest } from './notifications.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const spec = parse(readFileSync(new URL('../openapi/openapi.yaml', import.meta.url), 'utf8'))
const TOKEN = { DEV_TOKEN: 's3cret' }
const auth = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }

// The demo workspace has David (owner), Alex (editor) and Sam (viewer), all in the default team, and the Clinic booking project with its
// themes, requirements document, stories and agent steps. A second team, Support, takes that project; Alex and Sam are not in it.
async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  const q = async (sql: string, params: unknown[] = []) => (await pg.query<any>(sql, params)).rows
  const ws = (await q(`select id from core.workspaces limit 1`))[0].id as string
  const general = (await q(`select id from core.teams where workspace_id = $1 and is_default`, [ws]))[0].id as string
  const support = (await q(`insert into core.teams (workspace_id, name) values ($1, 'Support') returning id`, [ws]))[0].id as string
  const project = (await q(`select id from core.projects where name = 'Clinic booking, usability round 1'`))[0].id as string
  const other = (await q(`select id from core.projects where name = 'New patient intake (draft)'`))[0].id as string
  await q(`update core.projects set team_id = $1 where id = $2`, [support, project])
  const user = async (key: string) => (await q(`select id from core.users where email like $1`, [`${key}@%`]))[0].id as string
  const as = (email?: string) => createApp({ env: { ...TOKEN, ...(email ? { DEV_USER_EMAIL: `${email}@demo.signalflow.example` } : {}) }, getDb: () => db })
  const ids = {
    theme: (await q(`select id from research.themes where project_id = $1 limit 1`, [project]))[0].id as string,
    spec: (await q(`select id from delivery.specs where project_id = $1 limit 1`, [project]))[0].id as string,
    story: (await q(`select s.id from delivery.stories s join delivery.specs sp on sp.id = s.spec_id where sp.project_id = $1 limit 1`, [project]))[0].id as string,
    step: (await q(`select st.id from core.agent_steps st join core.agent_runs r on r.id = st.run_id where r.project_id = $1 limit 1`, [project]))[0].id as string,
  }
  const send = (who: ReturnType<typeof as>, method: string, path: string, body?: unknown) =>
    who.request(`/api/v1${path}`, { method, headers: { ...auth, 'if-match': '1' }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { pg, db, q, ws, general, support, project, other, ids, user, as, send, david: as(), alex: as('alex'), sam: as('sam') }
}

test('effective roles: a leader is an owner; others are editors if they edit in any team, never owners by a team role', () => {
  assert.equal(effectiveRole('owner', {}), 'owner')
  assert.equal(effectiveRole('editor', { a: 'viewer' }), 'viewer')
  assert.equal(effectiveRole('editor', { a: 'viewer', b: 'editor' }), 'editor')
  assert.equal(effectiveRole('editor', { a: 'owner' }), 'editor', 'a team owner is not a workspace owner')
  assert.equal(effectiveRole('viewer', {}), 'viewer')
})

test('paths name a project directly or through a theme, document, story or step', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  assert.deepEqual(scopeOf(`/projects/${id}`), { kind: 'project', id })
  assert.deepEqual(scopeOf(`/projects/${id}/themes`), { kind: 'project', id })
  assert.deepEqual(scopeOf(`/themes/${id}/area`), { kind: 'theme', id })
  assert.deepEqual(scopeOf(`/specs/${id}/themes/${id}`), { kind: 'spec', id })
  assert.deepEqual(scopeOf(`/stories/${id}`), { kind: 'story', id })
  assert.deepEqual(scopeOf(`/agent-steps/${id}/approve`), { kind: 'step', id })
  assert.equal(scopeOf('/projects'), null)
  assert.equal(scopeOf('/projects/new'), null)
  assert.equal(scopeOf('/specs/standalone'), null)
  assert.equal(scopeOf('/insights/themes/' + id), null)
})

test('the migration puts everyone and every project in one default team, and new members and projects follow', async () => {
  const f = await fixture()
  const members = await f.q(`select count(*)::int n from core.team_memberships where team_id = $1`, [f.general])
  assert.equal(members[0].n, 3, 'David, Alex and Sam')
  const roles = Object.fromEntries((await f.q(`select u.email, tm.role from core.team_memberships tm join core.users u on u.id = tm.user_id where tm.team_id = $1`, [f.general])).map((r) => [String(r.email).split('@')[0], r.role]))
  assert.deepEqual(roles, { david: 'owner', alex: 'editor', sam: 'viewer' })
  assert.equal((await f.q(`select count(*)::int n from core.projects where team_id is null`))[0].n, 0, 'no project is left without a team')
  // A project inserted without a team lands in the default team (the previous code does exactly this while it still serves).
  const made = (await f.q(`insert into core.projects (workspace_id, name, kind) values ($1, 'Late arrival', 'research') returning team_id`, [f.ws]))[0]
  assert.equal(made.team_id, f.general)
  // A person added to the workspace joins the default team with the same role, and a role change follows.
  const u = (await f.q(`insert into core.users (email, display_name) values ('new.person@demo.signalflow.example', 'New') returning id`))[0].id
  await f.q(`insert into core.memberships (workspace_id, user_id, role) values ($1, $2, 'viewer')`, [f.ws, u])
  assert.equal((await f.q(`select role from core.team_memberships where team_id = $1 and user_id = $2`, [f.general, u]))[0].role, 'viewer')
  await f.q(`update core.memberships set role = 'editor' where user_id = $1`, [u])
  assert.equal((await f.q(`select role from core.team_memberships where team_id = $1 and user_id = $2`, [f.general, u]))[0].role, 'editor')
})

test('a member of another team does not see a project: not in the list, and every route about it answers not found', async () => {
  const f = await fixture()
  const list = async (who: ReturnType<typeof f.as>) => (await (await who.request('/api/v1/projects', { headers: auth })).json()).data.map((p: any) => p.id)
  assert.ok(!(await list(f.alex)).includes(f.project), 'Alex is not in Support')
  assert.ok((await list(f.alex)).includes(f.other), 'but sees the General team’s own project')
  assert.ok(!(await list(f.sam)).includes(f.project))
  assert.ok((await list(f.david)).includes(f.project), 'a leader sees every team')
  for (const path of [`/projects/${f.project}`, `/projects/${f.project}/themes`, `/projects/${f.project}/board`, `/projects/${f.project}/storyboard`, `/projects/${f.project}/design`, `/projects/${f.project}/measure`, `/themes/${f.ids.theme}`, `/specs/${f.ids.spec}`, `/stories/${f.ids.story}`]) {
    const res = await f.alex.request(`/api/v1${path}`, { headers: auth })
    assert.equal(res.status, 404, `${path} must not leak to another team`)
  }
  const specs = (await (await f.alex.request('/api/v1/specs', { headers: auth })).json()).data
  assert.ok(specs.every((s: any) => s.projectId !== f.project), 'the documents list leaves out another team’s')
})

test('roles in a team: a leader outside it can read but not change; a viewer reads; an editor changes; the read-only visitor sees all', async () => {
  const f = await fixture()
  const get = (who: ReturnType<typeof f.as>) => who.request(`/api/v1/projects/${f.project}`, { headers: auth })
  assert.equal((await get(f.david)).status, 200)
  // David is the workspace owner and not in Support: read-only there.
  const study = { name: 'Renamed by a leader', methods: [], description: null, participants: [{ id: null, name: 'A', role: null, email: 'a@x.test', phone: null, sessionMinutes: null }] }
  assert.equal((await f.send(f.david, 'PUT', `/projects/${f.project}/study`, study)).status, 403, 'a leader outside the team may not edit')
  // Alex joins Support as a viewer, then as an editor.
  await f.q(`insert into core.team_memberships (workspace_id, team_id, user_id, role) values ($1, $2, $3, 'viewer')`, [f.ws, f.support, await f.user('alex')])
  // (The demo token's identity is remembered for a minute, so each change of role is read by a fresh app.)
  const viewer = f.as('alex')
  assert.equal((await get(viewer)).status, 200)
  assert.equal((await f.send(viewer, 'PUT', `/projects/${f.project}/study`, study)).status, 403, 'a team viewer may not edit')
  await f.q(`update core.team_memberships set role = 'editor' where team_id = $1 and user_id = $2`, [f.support, await f.user('alex')])
  const editor = f.as('alex')
  const detail = await (await get(editor)).json()
  assert.notEqual((await f.send(editor, 'PUT', `/projects/${f.project}/study`, { ...study, name: detail.name })).status, 403, 'a team editor may')
  // The visitor with no token sees everything, read-only, as the demo always did.
  const visitor = createApp({ env: TOKEN, getDb: () => f.db })
  assert.equal((await visitor.request(`/api/v1/projects/${f.project}`)).status, 200)
  assert.deepEqual((await (await visitor.request('/api/v1/me')).json()).teams, [], 'the visitor is shown no one’s teams')
})

test('new projects go to a team the person edits', async () => {
  const f = await fixture()
  const body = (extra = {}) => ({ name: 'Fresh', participants: [{ name: 'A', email: 'a@x.test' }], ...extra })
  const make = (who: ReturnType<typeof f.as>, extra = {}) => who.request('/api/v1/projects', { method: 'POST', headers: auth, body: JSON.stringify(body(extra)) })
  const first = await make(f.alex)
  assert.equal(first.status, 201)
  assert.equal((await first.json()).teamId, f.general, 'Alex edits in one team, so that is the team')
  const wrong = await make(f.alex, { teamId: f.support })
  assert.equal(wrong.status, 422, 'not an editor of Support')
  assert.equal((await make(f.sam)).status, 403, 'a viewer cannot create')
  await f.q(`insert into core.team_memberships (workspace_id, team_id, user_id, role) values ($1, $2, $3, 'editor')`, [f.ws, f.support, await f.user('alex')])
  const alex2 = f.as('alex')
  const both = await make(alex2)
  assert.equal(both.status, 201, 'with two editing teams the default team is used')
  assert.equal((await both.json()).teamId, f.general)
  const chosen = await make(alex2, { teamId: f.support })
  assert.equal((await chosen.json()).teamId, f.support)
})

// Every route that names a project, directly or through a theme, document, story or step, must refuse a caller outside the team. This walks
// the API spec so a route added later cannot be forgotten: it either starts with one of the scoped prefixes (and is then checked here) or has
// to be listed below as not about a single project, with the reason.
const NOT_ONE_PROJECT: Record<string, string> = {
  '/health': 'no data', '/health/db': 'no data', '/health/capture': 'no data', '/ai/status': 'workspace-wide', '/me': 'the caller', '/sign-in-options': 'no data',
  '/members': 'workspace administration', '/members/{id}': 'workspace administration', '/usage': 'workspace administration', '/audit': 'workspace administration',
  '/notifications/preferences': 'the caller', '/notifications/digest/test': 'the caller', '/notifications/unsubscribe': 'the caller', '/cron/digest': 'the scheduler',
  '/teams': 'team administration, owners only', '/teams/{id}': 'team administration, owners only', '/teams/{id}/members/{memberId}': 'team administration, owners only', '/teams/{id}/projects/{projectId}': 'team administration, owners only',
  '/templates': 'workspace-wide', '/projects': 'a list, scoped by the team filter (checked above)', '/specs': 'a list, scoped by the team filter (checked above)', '/specs/standalone': 'creates a project in a team the caller edits',
  // Shared across teams until Platform Insights is scoped to teams (the next slice of the Teams work).
  '/areas': 'shared categories', '/areas/proposals': 'shared categories', '/areas/proposals/accept': 'shared categories', '/areas/proposals/dismiss': 'shared categories', '/areas/{id}': 'shared categories', '/areas/{id}/merge': 'shared categories', '/areas/{id}/retire': 'shared categories',
  '/workflows': 'blueprints', '/workflows/sample': 'blueprints', '/workflows/{id}': 'blueprints',
  '/insights/themes': 'Platform Insights', '/insights/themes/{id}': 'Platform Insights', '/insights/themes/{id}/reviewed': 'Platform Insights', '/insights/themes/{id}/merge': 'Platform Insights', '/insights/themes/{id}/area': 'Platform Insights',
  '/insights/merges': 'Platform Insights', '/insights/merges/{id}/undo': 'Platform Insights', '/insights/merge-suggestions/run': 'Platform Insights', '/insights/merge-suggestions/{id}/accept': 'Platform Insights', '/insights/merge-suggestions/{id}/dismiss': 'Platform Insights',
  '/insights/roadmap/rationale': 'Platform Insights', '/insights/customers': 'Platform Insights', '/insights/journey': 'Platform Insights', '/insights/case-briefs': 'Platform Insights', '/insights/case-studies': 'Platform Insights',
}
const SCOPED = /^\/(projects|themes|specs|stories|agent-steps)\/\{(id|themeId)\}/

test('every route about a project refuses a caller outside its team (the API spec is walked, so a new route cannot be missed)', async () => {
  const f = await fixture()
  const idFor = (path: string): string => {
    if (path.startsWith('/projects/')) return f.project
    if (path.startsWith('/themes/')) return f.ids.theme
    if (path.startsWith('/specs/')) return f.ids.spec
    if (path.startsWith('/stories/')) return f.ids.story
    return f.ids.step
  }
  const unlisted: string[] = []
  let checked = 0
  for (const [path, item] of Object.entries<any>(spec.paths)) {
    if (!SCOPED.test(path)) {
      if (!(path in NOT_ONE_PROJECT)) unlisted.push(path)
      continue
    }
    for (const method of ['get', 'put', 'post', 'patch', 'delete']) {
      if (!item[method]) continue
      const url = path.replace('{id}', idFor(path)).replace('{themeId}', f.ids.theme)
      const res = await f.send(f.alex, method.toUpperCase(), url, method === 'get' || method === 'delete' ? undefined : {})
      assert.equal(res.status, 404, `${method.toUpperCase()} ${path} answered ${res.status} to a caller outside the team`)
      checked++
    }
  }
  assert.deepEqual(unlisted, [], 'routes that are neither about a project nor listed as exceptions')
  assert.ok(checked >= 30, `checked ${checked} routes`)
})

test('team administration: leaders create, rename, fill, move projects into and delete teams; nobody else may', async () => {
  const f = await fixture()
  const call = (who: ReturnType<typeof f.as>, method: string, path: string, body?: unknown) => who.request(`/api/v1${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) })
  assert.equal((await call(f.alex, 'GET', '/teams')).status, 403, 'an editor cannot see the team admin')
  assert.equal((await call(f.sam, 'POST', '/teams', { name: 'X' })).status, 403)
  const created = await call(f.david, 'POST', '/teams', { name: 'Billing' })
  assert.equal(created.status, 201)
  const billing = (await created.json()).id as string
  assert.equal((await call(f.david, 'POST', '/teams', { name: ' billing ' })).status, 409, 'a team name is unique, ignoring case')
  assert.equal((await call(f.david, 'POST', '/teams', { name: '  ' })).status, 422)
  assert.equal((await call(f.david, 'PATCH', `/teams/${billing}`, { name: 'Billing and plans' })).status, 200)
  const alexMember = (await f.q(`select m.id from core.memberships m join core.users u on u.id = m.user_id where u.email like 'alex@%'`))[0].id
  const added = await call(f.david, 'PUT', `/teams/${billing}/members/${alexMember}`, { role: 'viewer' })
  assert.equal(added.status, 200)
  assert.deepEqual((await added.json()).members.map((m: any) => [m.email.split('@')[0], m.role]), [['alex', 'viewer']])
  assert.equal((await call(f.david, 'PUT', `/teams/${billing}/members/${alexMember}`, { role: 'editor' })).status, 200, 'the same call changes the role')
  assert.equal((await call(f.david, 'PUT', `/teams/${billing}/members/11111111-1111-4111-8111-111111111111`, { role: 'editor' })).status, 404)
  // The team's projects: move one in, and the team cannot then be deleted.
  const moved = await call(f.david, 'PUT', `/teams/${billing}/projects/${f.other}`)
  assert.equal(moved.status, 200)
  assert.deepEqual((await moved.json()).projects.map((p: any) => p.id), [f.other])
  assert.equal((await call(f.david, 'DELETE', `/teams/${billing}`)).status, 409, 'a team with projects cannot be deleted')
  assert.equal((await call(f.david, 'DELETE', `/teams/${f.general}`)).status, 409, 'the default team cannot be deleted')
  await call(f.david, 'PUT', `/teams/${f.general}/projects/${f.other}`)
  assert.equal((await call(f.david, 'DELETE', `/teams/${billing}/members/${alexMember}`)).status, 204)
  assert.equal((await call(f.david, 'DELETE', `/teams/${billing}`)).status, 204)
  const list = (await (await call(f.david, 'GET', '/teams')).json()).data
  assert.deepEqual(list.map((t: any) => t.name), ['General', 'Support'])
  // Every change is in the audit log, under its own group.
  const audit = (await (await call(f.david, 'GET', '/audit?group=teams')).json()).data.map((e: any) => `${e.entity}:${e.verb}`)
  for (const want of ['core.teams:created', 'core.teams:renamed', 'core.team_memberships:added', 'core.team_memberships:role_changed', 'core.teams:project_moved', 'core.team_memberships:removed', 'core.teams:deleted']) assert.ok(audit.includes(want), `the audit log has ${want}`)
})

test('removing a person from the workspace takes them out of every team', async () => {
  const f = await fixture()
  const sam = (await f.q(`select m.id, m.user_id from core.memberships m join core.users u on u.id = m.user_id where u.email like 'sam@%'`))[0]
  await f.q(`insert into core.team_memberships (workspace_id, team_id, user_id, role) values ($1, $2, $3, 'viewer')`, [f.ws, f.support, sam.user_id])
  const res = await f.david.request(`/api/v1/members/${sam.id}`, { method: 'DELETE', headers: auth })
  assert.equal(res.status, 204)
  assert.equal((await f.q(`select count(*)::int n from core.team_memberships where user_id = $1`, [sam.user_id]))[0].n, 0)
})

test('Platform Insights shows a team member only their teams’ research; leaders see all; platform curation is for leaders', async () => {
  const f = await fixture()
  const get = async (who: ReturnType<typeof f.as>, path: string) => (await who.request(`/api/v1${path}`, { headers: auth })).json()
  const name = 'Clinic booking, usability round 1'
  const leader = await get(f.david, '/insights/themes')
  const member = await get(f.alex, '/insights/themes')
  assert.ok(leader.projects.some((p: any) => p.id === f.project), 'the leader sees the project in Support')
  assert.ok(!member.projects.some((p: any) => p.id === f.project), 'Alex is not in Support')
  assert.ok(member.projects.length > 0 && member.projects.length < leader.projects.length)
  assert.ok(member.totalParticipants < leader.totalParticipants, 'the people behind the other team’s project are not counted')
  assert.ok(member.themes.length <= leader.themes.length && member.themes.every((t: any) => t.sources.length > 0), 'no theme without research in Alex’s teams')
  assert.ok(member.themes.every((t: any) => t.sources.every((s: any) => s.projectId !== f.project)))
  for (const path of ['/insights/themes', '/insights/customers', '/insights/journey', '/insights/case-studies', '/insights/case-briefs', '/workflows']) {
    const text = JSON.stringify(await get(f.alex, path))
    assert.ok(!text.includes(f.project) && !text.includes(name), `${path} leaves out the other team’s project`)
  }
  assert.ok(JSON.stringify(await get(f.david, '/insights/customers')).includes(f.project), 'and the leader still has it')
  // A project's own workflow count only counts what the caller can see.
  const blueprintCount = (data: any) => data.data.reduce((n: number, w: any) => n + w.projectCount, 0)
  assert.ok(blueprintCount(await get(f.alex, '/workflows')) <= blueprintCount(await get(f.david, '/workflows')))
  // Joining the team shows it.
  await f.q(`insert into core.team_memberships (workspace_id, team_id, user_id, role) values ($1, $2, $3, 'viewer')`, [f.ws, f.support, await f.user('alex')])
  const joined = await get(f.as('alex'), '/insights/themes')
  assert.ok(joined.projects.some((p: any) => p.id === f.project))
  // Platform themes belong to everyone's data, so only leaders curate them.
  const theme = leader.themes[0].id
  assert.equal((await f.as('alex').request(`/api/v1/insights/themes/${theme}`, { method: 'PATCH', headers: auth, body: JSON.stringify({ title: 'Renamed by an editor' }) })).status, 403)
  assert.equal((await f.as('alex').request('/api/v1/insights/merge-suggestions/run', { method: 'POST', headers: auth })).status, 403)
})

test('AI spend is shown by the team of the project each call was for; a call for no one project is the workspace’s own', async () => {
  const f = await fixture()
  const run = (await f.q(`select id from core.agent_runs where project_id = $1 limit 1`, [f.project]))[0].id
  await f.q(`insert into core.ai_usage (workspace_id, run_id, purpose, provider, cost_usd) values ($1, $2, 'analysis', 't', 0.5), ($1, $2, 'spec_step', 't', 0.25), ($1, null, 'theme_match', 't', 0.1)`, [f.ws, run])
  const rows = await spendByTeam(f.db, f.ws)
  assert.deepEqual(rows.map((r) => [r.name, Number(r.spentUsd.toFixed(2))]), [['Support', 0.75], [null, 0.1]])
})

test('the audit log can be narrowed to one team, and says which team a change was about', async () => {
  const f = await fixture()
  const call = (method: string, path: string, body?: unknown) => f.david.request(`/api/v1${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) })
  const billing = (await (await call('POST', '/teams', { name: 'Billing' })).json()).id as string
  await call('PUT', `/teams/${billing}/projects/${f.other}`)
  const all = (await (await call('GET', '/audit?group=teams')).json()).data
  assert.ok(all.every((e: any) => e.team === null || typeof e.team.name === 'string'))
  const ofBilling = (await (await call('GET', `/audit?teamId=${billing}`)).json()).data
  assert.ok(ofBilling.length >= 2 && ofBilling.every((e: any) => e.team?.id === billing), 'the team’s own creation and the project moved into it')
  assert.deepEqual(ofBilling.map((e: any) => e.verb).sort(), ['created', 'project_moved'])
  assert.equal((await call('GET', '/audit?teamId=nope')).status, 422)
})

test('the reminder groups projects under their team when a person edits in several', () => {
  const item = (name: string, teamName: string) => ({ projectId: name, teamId: teamName, teamName, name, text: 'Next', path: `/projects/${name}/plan`, fingerprint: name })
  const two = composeDigest({ name: 'Pat', items: [item('Alpha', 'Support'), item('Beta', 'Billing'), item('Gamma', 'Support')], base: 'https://x.test', settingsUrl: 'https://x.test/s', unsubscribe: null })
  assert.match(two.text, /Billing\n- Beta[^]*Support\n- Alpha[^]*- Gamma/)
  assert.match(two.html, /<strong>Billing<\/strong>/)
  const one = composeDigest({ name: 'Pat', items: [item('Alpha', 'Support'), item('Gamma', 'Support')], base: 'https://x.test', settingsUrl: 'https://x.test/s', unsubscribe: null })
  assert.ok(!one.text.includes('Support\n'), 'one team: nothing to group')
})

test('sign-in groups name teams and roles: signalflow-<team>-<role>, highest role wins, other groups are ignored', () => {
  const got = (groups: string[]) => Object.fromEntries(teamRolesFromGroups('signalflow-', groups))
  assert.deepEqual(got(['signalflow-support-editors', 'Signalflow-Billing-Viewer', 'other-support-owners', 'signalflow-support-viewers']), { support: 'editor', billing: 'viewer' })
  assert.deepEqual(got(['SIGNALFLOW-Customer-Success-OWNERS']), { 'customer-success': 'owner' })
  assert.deepEqual(got(['signalflow-support', 'signalflow--editors', 'signalflow-support-admins']), {}, 'no role word, no team, or an unknown role: not a team group')
  assert.deepEqual(teamRolesFromGroups(null, ['signalflow-support-editors']), new Map(), 'without a prefix nothing is read')
  assert.equal(teamSlug('Customer Success'), 'customer-success')
  assert.equal(teamSlug(' Support & Ops! '), 'support-ops')
})

test('with team groups on, signing in puts a person in the teams their groups name and takes them out when the group goes', async () => {
  const f = await fixture()
  const env = { SSO_TEAM_GROUP_PREFIX: 'signalflow-', DEV_TOKEN: 's3cret' }
  const app = createApp({ env, getDb: () => f.db, auth: fakeAuth() })
  const as = (groups: string[]) => ({ 'x-test-user': JSON.stringify({ id: 'sub-alex', email: 'alex@demo.signalflow.example', groups }) })
  const me = async (groups: string[]) => (await (await app.request('/api/v1/me', { headers: as(groups) })).json()) as { teams: { name: string; role: string }[]; teamsManagedBySso: boolean }
  const mine = (m: { teams: { name: string; role: string }[] }) => Object.fromEntries(m.teams.map((t) => [t.name, t.role]))
  const first = await me(['SignalFlow-Support-Editors', 'signalflow-nowhere-viewers', 'signalflow-general-owners'])
  assert.equal(first.teamsManagedBySso, true)
  assert.deepEqual(mine(first), { General: 'editor', Support: 'editor' }, 'Support from the group; the default team is not managed by groups; a group for a team that does not exist is ignored')
  assert.deepEqual(mine(await me(['signalflow-support-viewers'])), { General: 'editor', Support: 'viewer' }, 'a changed group changes the role')
  assert.deepEqual(mine(await me([])), { General: 'editor' }, 'no group, no place in the team')
  const verbs = (await f.q(`select verb from core.audit_log where entity = 'core.team_memberships' and verb like '%sign-in groups' order by created_at, id`)).map((r) => r.verb)
  assert.deepEqual(verbs, ['added by sign-in groups', 'role set by sign-in groups', 'removed by sign-in groups'])
  // The Teams page may not edit those teams' people (they would be undone at the next sign-in), but still manages the default team's.
  const leader = createApp({ env: { ...env }, getDb: () => f.db })
  const alexMember = (await f.q(`select m.id from core.memberships m join core.users u on u.id = m.user_id where u.email like 'alex@%'`))[0].id
  const put = (team: string) => leader.request(`/api/v1/teams/${team}/members/${alexMember}`, { method: 'PUT', headers: auth, body: JSON.stringify({ role: 'viewer' }) })
  assert.equal((await put(f.support)).status, 409)
  assert.equal((await put(f.general)).status, 200)
})
