// Connecting Slack, Jira and Salesforce from inside the app: the secret is tried against the service first, stored encrypted, never sent back, audited without it, owner only. Run with: npm run test:api
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createApp } from './app.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}
const headers = { authorization: 'Bearer s3cret', 'content-type': 'application/json' }
const KEY = randomBytes(32).toString('base64')
// Built in pieces on purpose: written out whole, a fake token looks like a real Slack token and GitHub's push protection refuses the push.
const SLACK_TOKEN = ['xoxb', '1111111111', '2222222222', 'abcdefghijklmnop'].join('-')
const JIRA_TOKEN = 'ATATT3xFfGF0-example-jira-api-token-123'
const SF_SECRET = 'sf-consumer-secret-0123456789'
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Stand-ins for the three services: each accepts one credential and says what the real one says when it is wrong.
const slackFetch = async (url: string, init?: RequestInit) => {
  const auth = (init?.headers as Record<string, string>)?.authorization
  if (!url.endsWith('/auth.test')) return json({ ok: false, error: 'unknown_method' })
  return auth === `Bearer ${SLACK_TOKEN}` ? json({ ok: true, team: 'Acme Co' }) : json({ ok: false, error: 'invalid_auth' })
}
const jiraFetch = async (url: string, init?: RequestInit) => {
  const auth = (init?.headers as Record<string, string>)?.authorization
  if (auth !== `Basic ${Buffer.from(`me@acme.com:${JIRA_TOKEN}`).toString('base64')}`) return json({ errorMessages: ['bad credentials'] }, 401)
  if (url.endsWith('/myself')) return json({ accountId: 'a1' })
  if (url.endsWith('/project/ACME')) return json({ name: 'Acme', issueTypes: [] })
  return json({ errorMessages: ['No project could be found'] }, 404)
}
const salesforceFetch = async (url: string, init?: RequestInit) => {
  if (url.endsWith('/oauth2/token')) {
    const form = new URLSearchParams(String(init?.body))
    return form.get('client_secret') === SF_SECRET ? json({ access_token: 't' }) : json({ error: 'invalid_client' }, 400)
  }
  const soql = decodeURIComponent(url.replace(/\+/g, ' '))
  return /ARR__c/.test(soql) ? json({ done: true, records: [{ Id: '001', ARR__c: 1000 }] }) : json([{ errorCode: 'INVALID_FIELD' }], 400)
}

async function fixture(withKey = true) {
  const { pglite: pg, db } = await createDemoDatabase()
  const env = { DEV_TOKEN: 's3cret', ...(withKey ? { SETTINGS_ENCRYPTION_KEY: KEY } : {}) }
  const make = (extra: Record<string, string> = {}) => createApp({ env: { ...env, ...extra }, getDb: () => db, slackFetch, jiraFetch, salesforceFetch })
  const owner = make()
  const call = (app: ReturnType<typeof make>, method: string, path: string, body?: unknown) => app.request(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { pg, db, env, owner, editor: make({ DEV_USER_EMAIL: 'alex@demo.signalflow.example' }), call }
}
const stored = async (pg: any, kind: string) => (await pg.query(`select config, secret_enc from core.workspace_integrations where kind = $1`, [kind])).rows[0]
const verbs = async (pg: any) => (await pg.query(`select verb, after from core.audit_log where entity = 'core.workspace_integrations' order by created_at, id`)).rows

test('Slack: a wrong token is refused with plain words, the right one is stored encrypted and never sent back, and it can be replaced and removed', async () => {
  const { call, owner, pg } = await fixture()
  assert.equal((await call(owner, 'PUT', '/connections/slack', { token: 'not-a-token' })).status, 422)
  const wrong = await call(owner, 'PUT', '/connections/slack', { token: ['xoxb', '9999999999', '8888888888', 'wrongwrongwrongwrong'].join('-') })
  assert.equal(wrong.status, 422)
  assert.ok((await wrong.json()).error.message.length > 10)
  assert.equal(await stored(pg, 'slack'), undefined, 'nothing stored for either')

  const ok = await call(owner, 'PUT', '/connections/slack', { token: SLACK_TOKEN })
  assert.equal(ok.status, 200)
  const text = await ok.text()
  assert.ok(!text.includes(SLACK_TOKEN), 'the token is not in the answer')
  const body = JSON.parse(text)
  assert.deepEqual([body.slack, body.team], [{ connected: true, source: 'own' }, 'Acme Co'])
  const row = await stored(pg, 'slack')
  assert.match(row.secret_enc, /^v1\./)
  assert.ok(!JSON.stringify(row).includes(SLACK_TOKEN), 'only the encrypted value is stored')

  assert.equal((await call(owner, 'PUT', '/connections/slack', { token: SLACK_TOKEN })).status, 200, 'replacing works')
  const gone = await (await call(owner, 'DELETE', '/connections/slack')).json()
  assert.equal(gone.slack.connected, false, 'removed: gone at once')
  assert.equal(await stored(pg, 'slack'), undefined)
  const log = await verbs(pg)
  assert.deepEqual(log.map((r: any) => r.verb), ['connected', 'replaced key', 'disconnected'])
  assert.ok(!JSON.stringify(log).includes(SLACK_TOKEN), 'the audit log never holds the token')
  assert.deepEqual(log[0].after, { integration: 'Slack' })
})

test('Jira: the address, email and project key are checked, a refused sign-in and a missing project say so, and the right ones are stored with the token encrypted', async () => {
  const { call, owner, pg } = await fixture()
  const good = { baseUrl: 'https://acme.atlassian.net/', email: 'me@acme.com', token: JIRA_TOKEN, projectKey: 'acme' }
  assert.equal((await call(owner, 'PUT', '/connections/jira', { ...good, baseUrl: 'http://acme.atlassian.net' })).status, 422, 'https only')
  assert.equal((await call(owner, 'PUT', '/connections/jira', { ...good, baseUrl: 'not an address' })).status, 422)
  assert.equal((await call(owner, 'PUT', '/connections/jira', { ...good, email: 'nope' })).status, 422)
  assert.equal((await call(owner, 'PUT', '/connections/jira', { ...good, projectKey: '12 x' })).status, 422)
  const refused = await call(owner, 'PUT', '/connections/jira', { ...good, token: 'a-token-that-is-not-right-0123' })
  assert.equal(refused.status, 422)
  assert.match((await refused.json()).error.message, /refused the sign-in/)
  const missing = await call(owner, 'PUT', '/connections/jira', { ...good, projectKey: 'NOPE' })
  assert.match((await missing.json()).error.message, /could not find that project/)
  assert.equal(await stored(pg, 'jira'), undefined)

  // An address copied from the browser's bar, with no https:// and a page after it, is cut back to the address.
  const pasted = await call(owner, 'PUT', '/connections/jira', { ...good, baseUrl: 'acme.atlassian.net/jira/software/projects/ACME/boards/1' })
  assert.equal(pasted.status, 200)
  assert.equal((await pasted.json()).jira.siteUrl, 'https://acme.atlassian.net')
  const ok = await call(owner, 'PUT', '/connections/jira', good)
  assert.equal(ok.status, 200)
  const text = await ok.text()
  assert.ok(!text.includes(JIRA_TOKEN))
  assert.deepEqual(JSON.parse(text).jira, { connected: true, source: 'own', siteUrl: 'https://acme.atlassian.net', projectKey: 'ACME', email: 'me@acme.com' })
  assert.ok(!JSON.stringify(await stored(pg, 'jira')).includes(JIRA_TOKEN))
  assert.equal((await (await call(owner, 'DELETE', '/connections/jira')).json()).jira.connected, false)
})

test('Salesforce: a wrong secret and a missing ARR field are refused, the right ones connect, and Pulse sees it at once', async () => {
  const { call, owner, pg } = await fixture()
  await call(owner, 'PUT', '/pulse/preview', { enabled: true })
  const good = { instanceUrl: 'https://acme.my.salesforce.com', clientId: '3MVG9abcdefghijklmnop', clientSecret: SF_SECRET, arrField: 'ARR__c' }
  assert.equal((await call(owner, 'PUT', '/connections/salesforce', { ...good, instanceUrl: 'https://evil.example.com' })).status, 422, 'only Salesforce addresses')
  assert.equal((await call(owner, 'PUT', '/connections/salesforce', { ...good, instanceUrl: 'evil.example.com' })).status, 422, 'also without https://')
  assert.equal((await call(owner, 'PUT', '/connections/salesforce', { ...good, instanceUrl: 'http://acme.my.salesforce.com' })).status, 422, 'and never plain http')
  assert.equal((await call(owner, 'PUT', '/connections/salesforce', { ...good, arrField: 'ARR; drop' })).status, 422)
  const wrong = await call(owner, 'PUT', '/connections/salesforce', { ...good, clientSecret: 'a-secret-that-is-not-right-01' })
  assert.match((await wrong.json()).error.message, /refused/)
  const noField = await call(owner, 'PUT', '/connections/salesforce', { ...good, arrField: 'Missing__c' })
  assert.match((await noField.json()).error.message, /no such ARR field/)
  assert.equal(await stored(pg, 'salesforce'), undefined)

  // The address can be typed with or without https://, and is kept in its clean form.
  const bare = await call(owner, 'PUT', '/connections/salesforce', { ...good, instanceUrl: 'acme.my.salesforce.com' })
  assert.equal(bare.status, 200)
  assert.equal((await bare.json()).salesforce.instanceUrl, 'https://acme.my.salesforce.com')
  const ok = await call(owner, 'PUT', '/connections/salesforce', good)
  assert.equal(ok.status, 200)
  const text = await ok.text()
  assert.ok(!text.includes(SF_SECRET))
  assert.deepEqual(JSON.parse(text).salesforce, { connected: true, instanceUrl: 'https://acme.my.salesforce.com', arrField: 'ARR__c' })
  assert.ok(!JSON.stringify(await stored(pg, 'salesforce')).includes(SF_SECRET))
  assert.equal((await (await call(owner, 'GET', '/pulse/salesforce')).json()).connected, true, 'the Pulse card sees it without waiting')
  assert.equal((await (await call(owner, 'DELETE', '/connections/salesforce')).json()).salesforce.connected, false)
  assert.equal((await (await call(owner, 'GET', '/pulse/salesforce')).json()).connected, false)
})

test('only an owner can see or change connections, and a server with no encryption key says so instead of storing anything', async () => {
  const { call, owner, editor, pg } = await fixture()
  assert.deepEqual(Object.keys(await (await call(owner, 'GET', '/connections')).json()), ['slack', 'jira', 'salesforce', 'hubspot'])
  for (const [m, p, b] of [['GET', '/connections', undefined], ['PUT', '/connections/slack', { token: SLACK_TOKEN }], ['DELETE', '/connections/slack', undefined]] as const) assert.equal((await call(editor, m, p, b)).status, 403, `${m} ${p}`)
  const bare = await fixture(false)
  const refused = await bare.call(bare.owner, 'PUT', '/connections/slack', { token: SLACK_TOKEN })
  assert.equal(refused.status, 503)
  assert.match((await refused.json()).error.message, /no encryption key/)
  assert.equal(await stored(bare.pg, 'slack'), undefined)
  const shown = await (await call(owner, 'GET', '/audit?group=apps')).json()
  assert.ok(Array.isArray(shown.data))
  void pg
})
