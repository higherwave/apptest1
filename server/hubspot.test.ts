// The HubSpot connection (read only): tickets with their company, filters, paging, plain text, and what a refusal says. HubSpot is a stand-in (hubspot-demo.ts).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryValues, cleanPortalId, HubspotError, hubspotProblem, makeHubspot, plainTicketText, prettyCategory } from './hubspot.js'
import { DEMO_TICKETS, demoHubspotFetch } from './hubspot-demo.js'

const since = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString()

test('tickets come back oldest change first, with the company name, a link, and plain text', async () => {
  const hs = makeHubspot({ token: 'demo-key', portalId: '4455667' }, demoHubspotFetch())
  const tickets = await hs.fetchTickets({ since: since(90), categories: null })
  assert.equal(tickets.length, DEMO_TICKETS.length)
  assert.ok(tickets.every((t, i, all) => i === 0 || Date.parse(all[i - 1].modified) <= Date.parse(t.modified)), 'oldest change first')
  const first = tickets.find((t) => t.id === '9001')!
  assert.deepEqual([first.companyName, first.category, first.url], ['Northwind Logistics', 'Product issue', 'https://app.hubspot.com/contacts/4455667/record/0-5/9001'])
  assert.match(first.content, /health score for three accounts/)
})

test('a modified-since time and categories narrow the search, and a long list is read page by page', async () => {
  const hs = makeHubspot({ token: 'demo-key', portalId: null }, demoHubspotFetch(DEMO_TICKETS, 'demo-key', 3))
  assert.equal((await hs.fetchTickets({ since: since(90), categories: null })).length, DEMO_TICKETS.length, 'paged three at a time, all of them arrive')
  const recent = await hs.fetchTickets({ since: since(12), categories: null })
  assert.ok(recent.length > 0 && recent.length < DEMO_TICKETS.length && recent.every((t) => Date.parse(t.modified) >= Date.now() - 12 * 86_400_000))
  const features = await hs.fetchTickets({ since: since(90), categories: ['Feature request'] })
  assert.deepEqual(features.map((t) => t.category), ['Feature request', 'Feature request', 'Feature request'])
  assert.equal(features[0].url, null, 'no portal id, no link')
})

test('a ticket with no company has none, and a bad time is refused', async () => {
  const hs = makeHubspot({ token: 'demo-key', portalId: null }, demoHubspotFetch([{ ...DEMO_TICKETS[0], company: null }]))
  assert.equal((await hs.fetchTickets({ since: since(90), categories: null }))[0].companyName, null)
  await assert.rejects(() => hs.fetchTickets({ since: 'yesterday', categories: null }), HubspotError)
})

test('a refused key and a missing permission say what to do, never HubSpot’s own words', async () => {
  const wrong = makeHubspot({ token: 'not-the-key', portalId: null }, demoHubspotFetch())
  await assert.rejects(() => wrong.check(), (e: any) => e instanceof HubspotError && e.code === 'http_401' && /service key/.test(e.message))
  assert.match(hubspotProblem('http_403'), /crm\.objects\.tickets\.read/)
  assert.match(hubspotProblem('http_429'), /too often/)
  assert.equal(await makeHubspot({ token: 'demo-key', portalId: null }, demoHubspotFetch()).check(), undefined)
})

test('ticket text is plain words, and a portal id is digits only', () => {
  assert.equal(plainTicketText('<p>The score&nbsp;dropped &amp; nobody knows why.</p><br/>Please <b>help</b>'), 'The score dropped & nobody knows why. Please help')
  assert.deepEqual([cleanPortalId('4455667'), cleanPortalId(' 4455667 '), cleanPortalId('abc'), cleanPortalId(undefined)], ['4455667', '4455667', null, null])
})

test('a category is searched under the name as typed and under HubSpot’s internal form, and shown as words', () => {
  assert.deepEqual(categoryValues('Feature request'), ['Feature request', 'FEATURE_REQUEST'])
  assert.deepEqual(categoryValues(' BILLING_ISSUE '), ['BILLING_ISSUE'])
  assert.deepEqual([prettyCategory('PRODUCT_ISSUE'), prettyCategory('General inquiry'), prettyCategory('Custom thing')], ['Product issue', 'General inquiry', 'Custom thing'])
})
