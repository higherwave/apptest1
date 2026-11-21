// Fills Pulse with the Anchor CX story, so the preview has something to show: customers talking about the health score, handoffs between support and success,
// manual reporting and renewal prep, across a Slack channel and customer-meeting call notes.
//
//   npx tsx scripts/demo-pulse-signals.ts            dry run: reads only, says what it would add
//   npx tsx scripts/demo-pulse-signals.ts --yes      adds them
//
// Safe to run again: a signal whose text is already there is left alone. Nothing is deleted. The people and accounts are invented (Anchor CX is a fictional company).
// It does not turn the preview on: that is the switch in Admin, Previews.
// @ts-expect-error the migration helpers are plain .mjs with no types
import { loadEnvFile } from '../db/migrate.mjs'
import { findConnectionString, lazyPgDb, type Db } from '../server/db.js'

type Sample = { body: string; kind: 'complaint' | 'request' | 'praise' | 'question' | 'other'; source: 'manual' | 'notes' | 'slack'; label: string; by: string; account: string; daysAgo: number; status?: 'new' | 'kept' }

export const SAMPLES: Sample[] = [
  // Health score trust (the biggest topic: heard in every channel)
  { body: 'The health score dropped 18 points overnight and nobody on my team could tell me why. I ended up ignoring it for the renewal call.', kind: 'complaint', source: 'slack', label: '#cs-feedback', by: 'Marcus Bell', account: 'Northwind Logistics', daysAgo: 2 },
  { body: 'I do not trust the score anymore. Last quarter it said green on an account that churned three weeks later.', kind: 'complaint', source: 'notes', label: 'Renewal call with Contoso', by: 'Priya Raman', account: 'Contoso Health', daysAgo: 5 },
  { body: 'Can the score show which factors moved it? Even a short list would help me explain it to my director.', kind: 'request', source: 'slack', label: '#cs-feedback', by: 'Jordan Alvarez', account: 'Fabrikam Retail', daysAgo: 6 },
  { body: 'Customers ask why their health went amber and I have to say I am not sure. That is a bad moment on a call.', kind: 'complaint', source: 'notes', label: 'Customer call, Tailspin Travel', by: 'Lucia Ferreira', account: 'Tailspin Travel', daysAgo: 9 },
  { body: 'Our execs stopped looking at the score in the weekly review. They ask for the spreadsheet instead.', kind: 'complaint', source: 'notes', label: 'QBR notes, Adventure Works', by: 'Tom Okafor', account: 'Adventure Works', daysAgo: 12 },
  // Handoffs between support and success
  { body: 'When a hard case moves from support to my queue, I get a ticket link and nothing else. I redo the investigation from scratch.', kind: 'complaint', source: 'slack', label: '#cs-feedback', by: 'Samir Qureshi', account: 'Wide World Importers', daysAgo: 3 },
  { body: 'We need a way to hand an account to success with the history attached, not a Slack message that says "please take this one".', kind: 'request', source: 'notes', label: 'Support and success sync', by: 'Marcus Bell', account: 'Northwind Logistics', daysAgo: 8 },
  { body: 'Two different teams called the same customer in the same week without knowing it. They were not happy.', kind: 'complaint', source: 'notes', label: 'Customer meeting, CX Summit follow-up', by: 'A customer success director', account: 'Unknown', daysAgo: 15 },
  // Manual reporting
  { body: 'I spend the first Monday of every month building the portfolio report by hand from three exports. It takes about four hours.', kind: 'complaint', source: 'notes', label: 'Discovery call, Fabrikam', by: 'Derek Hollis', account: 'Fabrikam Retail', daysAgo: 4 },
  { body: 'A weekly digest of accounts that changed would save me the Monday scramble. I would read it every time.', kind: 'request', source: 'slack', label: '#cs-feedback', by: 'Ben Nakamura', account: 'Contoso Health', daysAgo: 7 },
  { body: 'Our board wants a one-page view of renewals at risk. Today it is a slide I rebuild each quarter.', kind: 'request', source: 'notes', label: 'Executive briefing call', by: 'Tom Okafor', account: 'Adventure Works', daysAgo: 13 },
  // Renewal prep
  { body: 'Preparing a renewal means opening five tabs. The context I need is all there, just not on one page.', kind: 'complaint', source: 'notes', label: 'Renewal prep shadowing', by: 'Jordan Alvarez', account: 'Fabrikam Retail', daysAgo: 10 },
  { body: 'The renewal playbook is great for mid-market, but my enterprise accounts need different steps and I cannot change it.', kind: 'request', source: 'slack', label: '#cs-feedback', by: 'Priya Raman', account: 'Contoso Health', daysAgo: 11 },
  // Praise and questions
  { body: 'The Customer 360 timeline is the first thing I open every morning. It saves me real time.', kind: 'praise', source: 'slack', label: '#cs-feedback', by: 'Lucia Ferreira', account: 'Tailspin Travel', daysAgo: 14 },
  { body: 'Is there a way to see which of our accounts have an open renewal opportunity and a falling health score together?', kind: 'question', source: 'notes', label: 'Renewal call with Contoso', by: 'Priya Raman', account: 'Contoso Health', daysAgo: 5 },
  // New ones waiting for review, as if the channel brought them in today
  { body: 'Heads up, the score on Northwind went red again and the factor list is still missing.', kind: 'complaint', source: 'slack', label: '#cs-feedback', by: 'Marcus Bell', account: 'Northwind Logistics', daysAgo: 0, status: 'new' },
  { body: 'lol the new dashboard is fine i guess', kind: 'other', source: 'slack', label: '#cs-feedback', by: 'Samir Qureshi', account: 'Wide World Importers', daysAgo: 0, status: 'new' },
]

/** Where each sample was heard, from the fixed channel list. */
const channelOf = (s: Sample) => (s.source === 'slack' ? 'slack' : 'call_notes')

export type Report = { lines: string[]; added: number }

export async function fillDemoSignals(db: Db, slug: string, apply: boolean, samples: Sample[] = SAMPLES): Promise<Report> {
  const lines: string[] = []
  const ws = (await db.query('select id, name from core.workspaces where slug = $1', [slug])).rows[0]
  if (!ws) throw new Error(`No workspace "${slug}".`)
  const wdb = db.inWorkspace(ws.id)
  const owner = (await wdb.query(`select user_id from core.memberships where workspace_id = $1 and role = 'owner' and not is_external order by created_at limit 1`, [ws.id])).rows[0]
  let added = 0
  for (const [i, s] of samples.entries()) {
    const have = (await wdb.query('select 1 from core.pulse_signals where workspace_id = $1 and body = $2 limit 1', [ws.id, s.body])).rows.length > 0
    if (have) {
      // A sample added earlier: bring its channel, source and label up to date (the channel list was cut to call notes, Slack and Salesforce), touching nothing else.
      if (apply) await wdb.query(`update core.pulse_signals set channel = $3, source = $4, source_label = $5 where workspace_id = $1 and body = $2 and (channel, source, source_label) is distinct from ($3, $4, $5)`, [ws.id, s.body, channelOf(s), s.source, s.label])
      continue
    }
    lines.push(`${apply ? 'adding' : 'would add'} [${s.source}] ${s.kind}: ${s.body.slice(0, 70)}${s.body.length > 70 ? '…' : ''}`)
    if (!apply) continue
    await wdb.query(
      `insert into core.pulse_signals (workspace_id, body, kind, channel, source, source_label, said_by, account, occurred_on, status, external_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, (current_date - $9::int), $10, $11, $12)`,
      [ws.id, s.body, s.kind, channelOf(s), s.source, s.label, s.by, s.account, s.daysAgo, s.status ?? 'kept', s.source === 'slack' ? `sample-${i}` : null, owner?.user_id ?? null],
    )
    added++
  }
  if (!lines.length) lines.push('All the sample signals are already there.')
  return { lines, added }
}

if (process.argv[1] && process.argv[1].endsWith('demo-pulse-signals.ts')) {
  const apply = process.argv.includes('--yes')
  loadEnvFile()
  const env = process.env as Record<string, string | undefined>
  const url = findConnectionString(env)
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).')
    process.exit(1)
  }
  const slug = env.WORKSPACE_SLUG || env.DEMO_WORKSPACE_SLUG || 'higherwave-demo'
  console.log(`Target: ${new URL(url).host}, workspace "${slug}"${apply ? '' : '  (dry run: nothing is written)'}`)
  fillDemoSignals(lazyPgDb(env)(), slug, apply)
    .then((r) => {
      r.lines.forEach((l) => console.log('  ' + l))
      console.log(apply ? `Done: ${r.added} added.` : 'Dry run only. Run again with --yes to apply.')
      process.exit(0)
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err)
      process.exit(1)
    })
}
