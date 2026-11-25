// Local API on a throwaway in-memory copy of the demo data (PGlite): no Neon, no cost, safe to break.
//   npm run dev:api:memory        (set DEV_TOKEN=... to try the read-only / unlock flow)
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createApp } from './app.js'
import { createDemoDatabase, fakeAuth } from './test-utils.js'
import { makeSlack, type SlackClient } from './slack.js'
// @ts-expect-error plain ESM helper
import { setIntegration } from '../db/set-integration.mjs'
import { fillDemoSignals } from '../scripts/demo-pulse-signals.js'
import { demoHubspotFetch } from './hubspot-demo.js'

// ANCHOR_CX=true also loads the Anchor CX demo story (db/seed/anchor-cx/README.md).
const { db, pglite } = await createDemoDatabase({ anchor: process.env.ANCHOR_CX === 'true' })
// PULSE_SAMPLES=true fills Pulse with the Anchor CX sample signals (scripts/demo-pulse-signals.ts) so the pages have something to show.
if (process.env.PULSE_SAMPLES === 'true') {
  const slug = ((await pglite.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  console.log(`Pulse samples: ${(await fillDemoSignals(db, slug, true)).added} added`)
}
const port = Number(process.env.API_PORT || 8787)
const env = { ...process.env }
// AUTH_TEST=true switches on sign-in with the stand-in service (see fakeAuth), for the browser tests of sign-in. It also
// adds POST /__test/public-view/true|false so a test can flip PUBLIC_VIEW while the server runs.
const testAuth = process.env.AUTH_TEST === 'true'
const testCapture = process.env.CAPTURE_TEST === 'true'
// The stand-in needs a provider to offer on the sign-in screen (it never contacts Google).
if (testAuth) Object.assign(env, { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID ?? 'test', GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET ?? 'test' })
// SLACK_DEMO=true stands in for Slack's channel reading only, so Pulse's "Check now" can be tried without a Slack app: any channel exists and holds a few
// Anchor CX customer-feedback messages. Posting stays as with no Slack.
const demoSlack: SlackClient | undefined =
  process.env.SLACK_DEMO === 'true'
    ? (() => {
        const base = makeSlack({})
        const at = (hoursAgo: number) => `${Math.floor(Date.now() / 1000) - hoursAgo * 3600}.000100`
        const messages = [
          { ts: at(30), text: 'Anchor CX admins keep telling us the weekly digest does not match what they see in the dashboard, so they stopped trusting the health score.', user: 'U1', bot: false, subtype: null },
          { ts: at(26), text: 'Renewal prep is still a scramble: nobody can tell which accounts have open risks before the QBR.', user: 'U2', bot: false, subtype: null },
          { ts: at(20), text: 'A customer asked again for scheduled exports of the usage report, third time this month.', user: 'U3', bot: false, subtype: null },
          { ts: at(5), text: 'When an account changes owners the context from the last call gets lost, handoffs are rough.', user: 'U1', bot: false, subtype: null },
        ]
        return { ...base, live: false, reads: true, findChannel: async (name: string) => `C_${name}`, history: async (_c: string, oldest: string | undefined) => messages.filter((m) => !oldest || Number(m.ts) > Number(oldest)) } as SlackClient
      })()
    : undefined
// SALESFORCE_DEMO=true connects a stand-in Salesforce holding ARR for most of the Anchor CX sample accounts (two are left out on purpose, to show "not found").
let salesforceFetch: ((url: string, init?: RequestInit) => Promise<Response>) | undefined
if (process.env.SALESFORCE_DEMO === 'true') {
  env.SETTINGS_ENCRYPTION_KEY = env.SETTINGS_ENCRYPTION_KEY ?? Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  const slug = ((await pglite.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await setIntegration(pglite, env, { slug, kind: 'salesforce', secret: 'demo-secret', site: 'https://anchor-demo.my.salesforce.com', clientId: 'demo-consumer-key', arrField: 'ARR__c' })
  const accounts = [
    { Id: '001D1', Name: 'Contoso Health, Inc.', ARR__c: 420000 },
    { Id: '001D2', Name: 'Fabrikam Retail', ARR__c: 180000 },
    { Id: '001D3', Name: 'Northwind Logistics LLC', ARR__c: 310000 },
    { Id: '001D4', Name: 'Tailspin Travel', ARR__c: 95000 },
  ]
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)
  const modified = (hoursAgo: number) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString().replace('Z', '+0000')
  const opportunities = [
    { Id: '006D00000000001AAA', Name: 'Contoso Health: renewal FY27', AccountId: '001D1', Account: { Name: 'Contoso Health, Inc.' }, Amount: 420000, StageName: 'Negotiation', CloseDate: day(30), IsClosed: false, IsWon: false, LastModifiedDate: modified(6), NextStep: 'Waiting on a clear explanation of how the health score is worked out before they sign.', Description: 'The exec team stopped trusting the score after it showed green on an account that churned.' },
    { Id: '006D00000000002AAA', Name: 'Northwind Logistics: expansion', AccountId: '001D3', Account: { Name: 'Northwind Logistics LLC' }, Amount: 310000, StageName: 'Proposal', CloseDate: day(60), IsClosed: false, IsWon: false, LastModifiedDate: modified(5), NextStep: 'They want a weekly digest of the accounts that changed before expanding. Reporting is all manual today.', Description: '' },
    { Id: '006D00000000003AAA', Name: 'Fabrikam Retail: renewal FY26', AccountId: '001D2', Account: { Name: 'Fabrikam Retail' }, Amount: 180000, StageName: 'Closed Lost', CloseDate: day(-20), IsClosed: true, IsWon: false, LastModifiedDate: modified(4), NextStep: '', Description: 'Lost: when a case moved from support to success the history was lost and the customer had to start over.' },
  ]
  salesforceFetch = async (url) => {
    if (url.endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'demo' }))
    const soql = decodeURIComponent(url.replace(/\+/g, ' '))
    return new Response(JSON.stringify({ done: true, records: /FROM Opportunity/.test(soql) ? opportunities : accounts }))
  }
}
// HUBSPOT_DEMO=true connects a stand-in HubSpot holding Anchor CX support tickets (the health score, handoffs, manual reporting), read only, with a key the stand-in accepts.
let hubspotFetch: ReturnType<typeof demoHubspotFetch> | undefined
if (process.env.HUBSPOT_DEMO === 'true') {
  env.SETTINGS_ENCRYPTION_KEY = env.SETTINGS_ENCRYPTION_KEY ?? Buffer.from('0123456789abcdef0123456789abcdef').toString('base64')
  const slug = ((await pglite.query<any>('select slug from core.workspaces limit 1')).rows[0] as { slug: string }).slug
  await setIntegration(pglite, env, { slug, kind: 'hubspot', secret: 'demo-hubspot-service-key-123456', portalId: '4455667' })
  hubspotFetch = demoHubspotFetch(undefined, 'demo-hubspot-service-key-123456')
}
const app = createApp({ env, getDb: () => db, auth: testAuth ? fakeAuth() : undefined, slack: demoSlack, salesforceFetch, hubspotFetch })
const root = new Hono()
if (testCapture) {
  // CAPTURE_TEST=true: thumbnails can be switched on and off while the server runs, and may visit this machine's own pages.
  env.DESIGN_CAPTURE = 'false'
  env.DESIGN_CAPTURE_ALLOW_PRIVATE = 'true'
  root.post('/__test/capture/:on', (c) => {
    env.DESIGN_CAPTURE = c.req.param('on') === 'true' ? 'true' : 'false'
    return c.json({ capture: env.DESIGN_CAPTURE })
  })
}
if (testAuth) {
  root.post('/__test/public-view/:on', (c) => {
    env.PUBLIC_VIEW = c.req.param('on') === 'true' ? 'true' : 'false'
    return c.json({ publicView: env.PUBLIC_VIEW })
  })
}
root.route('/', app)
serve({ fetch: root.fetch, port }, () => {
  console.log(`In-memory API on http://localhost:${port}/api/v1/health`)
  if (process.env.PULSE_SAMPLES === 'true') void setUpPulseDemo()
})

// With PULSE_SAMPLES=true, once the server is listening: switch Pulse on, copy the stand-in Salesforce accounts, designate opportunity notes as a source,
// read them, and group everything into topics, so the Pulse pages open with the full story (ARR, In play, Rank by).
async function setUpPulseDemo() {
  const call = async (method: string, path: string, body: unknown = {}) => {
    const res = await fetch(`http://localhost:${port}/api/v1/pulse${path}`, { method, headers: { 'content-type': 'application/json', ...(process.env.DEV_TOKEN ? { authorization: `Bearer ${process.env.DEV_TOKEN}` } : {}) }, body: JSON.stringify(body) })
    return res.ok ? res.json().catch(() => null) : null
  }
  await call('PUT', '/preview', { enabled: true })
  await call('PUT', '/demo', { enabled: true }) // shown to the read-only visitor too, so the demo mode can be tried (PUBLIC_VIEW=true with a DEV_TOKEN)
  if (process.env.SALESFORCE_DEMO === 'true') {
    await call('POST', '/salesforce/sync')
    const src = await call('POST', '/sources/opportunities', { fields: ['NextStep', 'Description'], scope: 'both', mode: 'keep' })
    if (src?.id) await call('POST', `/sources/${src.id}/check`)
  }
  if (process.env.HUBSPOT_DEMO === 'true') {
    const src = await call('POST', '/sources/tickets', { categories: [] })
    if (src?.id) await call('POST', `/sources/${src.id}/check`)
  }
  await call('POST', '/topics/update')
  console.log('Pulse demo set up: preview on, samples, Salesforce, topics')
}
