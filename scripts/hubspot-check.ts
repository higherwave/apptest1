// Tries a HubSpot service key from your own machine, before it is connected to anything: does HubSpot accept it, can it read tickets, and what would Pulse see. It writes nothing
// anywhere (not to HubSpot, not to the database) and prints only a count and the first few subjects.
//
//   HS_KEY='<service key>' npx tsx scripts/hubspot-check.ts            tries the key
//   HS_KEY='<service key>' npx tsx scripts/hubspot-check.ts --portal-id 12345678     also shows the link each ticket would have
import { makeHubspot, HubspotError } from '../server/hubspot.js'

const args = process.argv.slice(2)
const portalId = args.includes('--portal-id') ? args[args.indexOf('--portal-id') + 1] : null
const key = process.env.HS_KEY
if (!key) {
  console.error('Put the key in an environment variable first:  HS_KEY=\'<service key>\' npx tsx scripts/hubspot-check.ts')
  process.exit(1)
}
const hs = makeHubspot({ token: key, portalId: portalId && /^\d{3,12}$/.test(portalId) ? portalId : null })
try {
  await hs.check()
  console.log('1. HubSpot accepted the key, and it can search tickets.')
  const tickets = await hs.fetchTickets({ since: new Date(Date.now() - 90 * 86_400_000).toISOString(), categories: null })
  console.log(`2. ${tickets.length} ticket${tickets.length === 1 ? '' : 's'} changed in the last 90 days.`)
  for (const t of tickets.slice(0, 5)) console.log(`   - ${t.subject || '(no subject)'}  [${t.category ?? 'no category'}] ${t.companyName ? `· ${t.companyName}` : '· no company'}${t.url ? `\n     ${t.url}` : ''}`)
  const noCompany = tickets.filter((t) => !t.companyName).length
  if (tickets.length && noCompany) console.log(`   (${noCompany} of them have no company: Pulse will still read them, but cannot show an account for them.)`)
  if (!tickets.length) console.log('   Nothing yet. That is fine: add the demo tickets next, or create one by hand in HubSpot.')
  console.log('Done. Nothing was written anywhere.')
} catch (err) {
  console.error(`Problem: ${err instanceof HubspotError ? err.message : 'HubSpot could not be reached (check your internet connection).'}`)
  process.exit(1)
}
