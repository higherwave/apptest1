// A workspace's own connections: encrypted tokens, and the deployment's settings staying with the home workspace. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createDemoDatabase } from './test-utils.js'
import { makeIntegrations } from './workspace-settings.js'
import type { SlackClient } from './slack.js'
// @ts-expect-error plain ESM helper that creates a workspace
import { initWorkspace } from '../db/init-workspace.mjs'
import { sealSecret, openSecret } from '../shared/secret-box.mjs'

const KEY = randomBytes(32).toString('base64')
const env = { SETTINGS_ENCRYPTION_KEY: KEY, SLACK_BOT_TOKEN: 'xoxb-home', JIRA_BASE_URL: 'https://home.atlassian.test', JIRA_EMAIL: 'h@x.test', JIRA_API_TOKEN: 'home-token', JIRA_PROJECT_KEY: 'HOME' }

test('a sealed secret opens with the same key and with nothing else', () => {
  const sealed = sealSecret(env, 'xoxb-secret')
  assert.ok(sealed.startsWith('v1.') && !sealed.includes('xoxb-secret'))
  assert.equal(openSecret(env, sealed), 'xoxb-secret')
  assert.notEqual(sealSecret(env, 'xoxb-secret'), sealed, 'a fresh value each time')
  assert.equal(openSecret({ SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64') }, sealed), null, 'a different key')
  assert.equal(openSecret(env, sealed.slice(0, -2) + 'AA'), null, 'a changed value')
  assert.equal(openSecret({}, sealed), null, 'no key')
  assert.equal(openSecret(env, null), null)
  assert.throws(() => sealSecret({}, 'x'), /SETTINGS_ENCRYPTION_KEY/)
})

async function fixture() {
  const { pglite: pg, db } = await createDemoDatabase()
  await initWorkspace(pg, { name: 'Other', slug: 'other', owners: ['o@other.example.test'] })
  const ids = Object.fromEntries((await pg.query<any>(`select slug, id from core.workspaces`)).rows.map((r) => [r.slug, r.id]))
  const seen: { slackAuth: string[]; jiraAuth: string[] } = { slackAuth: [], jiraAuth: [] }
  const slackFetch = async (_url: string, init?: RequestInit) => {
    seen.slackAuth.push(String((init?.headers as Record<string, string>)?.authorization))
    return new Response(JSON.stringify({ ok: true, channel: 'C1', ts: '1.1', channels: [{ id: 'C1', name: 'general' }] }))
  }
  const jiraFetch = async (_url: string, init?: RequestInit) => {
    seen.jiraAuth.push(String((init?.headers as Record<string, string>)?.Authorization ?? (init?.headers as Record<string, string>)?.authorization))
    return new Response(JSON.stringify({ name: 'P', issueTypes: [], values: [] }))
  }
  const integrations = makeIntegrations({ env, platformDb: () => db, slackFetch: slackFetch as any, jiraFetch: jiraFetch as any })
  return { pg, db, ids, seen, integrations }
}
const tokenOf = (slack: SlackClient, seen: { slackAuth: string[] }) => slack.post('C1', 'x').then(() => seen.slackAuth.at(-1))

test('the deployment’s Slack and Jira belong to its home workspace; another workspace has none', async () => {
  const f = await fixture()
  const home = await f.integrations(f.ids['higherwave-demo'])
  assert.equal(home.slack.live, true)
  assert.ok(home.jira)
  assert.deepEqual(home.source, { slack: 'deployment', jira: 'deployment' })
  assert.equal(await tokenOf(home.slack, f.seen), 'Bearer xoxb-home')
  const other = await f.integrations(f.ids.other)
  assert.equal(other.slack.live, false, 'the second customer must not post through the home token')
  assert.equal(other.jira, null, 'nor create issues in the home Jira')
  assert.deepEqual(other.source, { slack: 'none', jira: 'none' })
})

test('a workspace with its own row uses its own token, decrypted; a row that will not decrypt is no connection', async () => {
  const f = await fixture()
  await f.pg.query(`insert into core.workspace_integrations (workspace_id, kind, secret_enc) values ($1, 'slack', $2)`, [f.ids.other, sealSecret(env, 'xoxb-other')])
  await f.pg.query(
    `insert into core.workspace_integrations (workspace_id, kind, config, secret_enc) values ($1, 'jira', $2, $3)`,
    [f.ids.other, JSON.stringify({ baseUrl: 'https://other.atlassian.test', email: 'o@other.test', projectKey: 'OTH' }), sealSecret(env, 'jira-other')],
  )
  const own = await f.integrations(f.ids.other)
  assert.equal(own.source.slack, 'own')
  assert.equal(await tokenOf(own.slack, f.seen), 'Bearer xoxb-other')
  assert.equal(own.source.jira, 'own')
  assert.ok(own.jira)
  // The home workspace is unaffected by the other's rows.
  assert.equal(await tokenOf((await f.integrations(f.ids['higherwave-demo'])).slack, f.seen), 'Bearer xoxb-home')
  // Sealed with another key: no connection, and no fallback to the home token.
  await f.pg.query(`update core.workspace_integrations set secret_enc = $2 where workspace_id = $1 and kind = 'slack'`, [f.ids.other, sealSecret({ SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString('base64') }, 'x')])
  const fresh = makeIntegrations({ env, platformDb: () => f.db })
  const broken = await fresh(f.ids.other)
  assert.equal(broken.source.slack, 'none')
  assert.equal(broken.slack.live, false, 'no fallback to the home token')
})

// @ts-expect-error plain ESM command-line tool
import { setIntegration, buildRow } from '../db/set-integration.mjs'

test('the command-line tool stores an encrypted token that the app then reads, and can take it away', async () => {
  const f = await fixture()
  assert.throws(() => buildRow(env, { kind: 'slack', secret: 'not-a-bot-token' }), /xoxb-/)
  assert.throws(() => buildRow(env, { kind: 'jira', secret: 't', site: 'http://insecure', email: 'a@b.co', project: 'AB' }), /https/)
  assert.throws(() => buildRow({}, { kind: 'slack', secret: 'xoxb-1' }), /SETTINGS_ENCRYPTION_KEY/)
  const saved = await setIntegration(f.pg, env, { slug: 'other', kind: 'slack', secret: 'xoxb-new' })
  assert.equal(saved.action, 'saved')
  const stored = (await f.pg.query<any>(`select secret_enc from core.workspace_integrations where workspace_id = $1`, [f.ids.other])).rows[0].secret_enc
  assert.ok(!stored.includes('xoxb-new'), 'never stored in clear')
  const fresh = makeIntegrations({ env, platformDb: () => f.db, slackFetch: (async (_u: string, init?: RequestInit) => { f.seen.slackAuth.push(String((init?.headers as any).authorization)); return new Response(JSON.stringify({ ok: true, channel: 'C', ts: '1' })) }) as any })
  assert.equal(await tokenOf((await fresh(f.ids.other)).slack, f.seen), 'Bearer xoxb-new')
  assert.equal((await setIntegration(f.pg, env, { slug: 'other', kind: 'slack', remove: true })).action, 'removed')
  assert.equal((await setIntegration(f.pg, env, { slug: 'other', kind: 'slack', remove: true })).action, 'nothing to remove')
  await assert.rejects(setIntegration(f.pg, env, { slug: 'nope', kind: 'slack', secret: 'xoxb-1' }), /No workspace/)
})
