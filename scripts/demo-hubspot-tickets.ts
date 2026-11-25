// Puts the Anchor CX support tickets into a HubSpot account, so Pulse has real tickets to read in a demo: ten tickets about the health score, handoffs, manual reporting and renewal
// prep, each belonging to one of the six Anchor CX companies (the same ones as the Salesforce demo). It is the only thing in Signal Flow that WRITES to HubSpot, and it is not part of the
// app: you run it yourself, with a SEPARATE, temporary service key that may write tickets and companies (delete that key afterwards; Pulse's own key stays read only).
//
//   HS_WRITE_KEY='<temporary key>' npx tsx scripts/demo-hubspot-tickets.ts          dry run: reads only, says what it would add
//   HS_WRITE_KEY='<temporary key>' npx tsx scripts/demo-hubspot-tickets.ts --yes    adds them
//
// Safe to run again: a ticket whose subject is already there is left alone, and a company that already exists (by exact name) is reused. Nothing is deleted or changed.
import { DEMO_TICKETS } from '../server/hubspot-demo.js'

const apply = process.argv.includes('--yes')
const key = process.env.HS_WRITE_KEY
if (!key) {
  console.error('Put the temporary key in an environment variable first:  HS_WRITE_KEY=\'<key>\' npx tsx scripts/demo-hubspot-tickets.ts')
  process.exit(1)
}
const API = 'https://api.hubapi.com'
const call = async (method: string, path: string, body?: unknown) => {
  const res = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
  const json = (await res.json().catch(() => ({}))) as any
  if (!res.ok) throw new Error(`HubSpot answered ${res.status} to ${method} ${path}${json?.message ? `: ${String(json.message).slice(0, 200)}` : ''}${res.status === 403 ? ' (the key needs the write scopes: crm.objects.tickets.write and crm.objects.companies.write, with their read scopes)' : ''}`)
  return json
}
const findOne = async (object: 'tickets' | 'companies', property: string, value: string) => (await call('POST', `/crm/v3/objects/${object}/search`, { filterGroups: [{ filters: [{ propertyName: property, operator: 'EQ', value }] }], properties: [property], limit: 1 })).results?.[0]?.id as string | undefined

console.log(`${apply ? 'Adding' : 'Dry run: would add'} up to ${DEMO_TICKETS.length} tickets${apply ? '' : '  (nothing is written; add --yes to do it)'}`)
const companyIds = new Map<string, string>()
let made = 0
let skipped = 0
try {
  for (const t of DEMO_TICKETS) {
    if (await findOne('tickets', 'subject', t.subject)) {
      console.log(`  already there: ${t.subject}`)
      skipped++
      continue
    }
    console.log(`  ${apply ? 'adding' : 'would add'}: ${t.subject}${t.company ? `  (${t.company.name})` : ''}`)
    if (!apply) continue
    let companyId: string | undefined
    if (t.company) {
      companyId = companyIds.get(t.company.name) ?? (await findOne('companies', 'name', t.company.name)) ?? (await call('POST', '/crm/v3/objects/companies', { properties: { name: t.company.name } })).id
      companyIds.set(t.company.name, companyId!)
    }
    await call('POST', '/crm/v3/objects/tickets', {
      properties: { subject: t.subject, content: t.content, hs_pipeline: '0', hs_pipeline_stage: '1', ...(t.category ? { hs_ticket_category: t.category } : {}) },
      ...(companyId ? { associations: [{ to: { id: companyId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 26 }] }] } : {}),
    })
    made++
  }
  console.log(apply ? `Done: ${made} added, ${skipped} already there.` : 'Dry run only. Run again with --yes to add them.')
} catch (err) {
  console.error(`Stopped: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
}
