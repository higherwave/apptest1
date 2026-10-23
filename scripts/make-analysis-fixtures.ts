// Writes the stand-in "recorded" model replies used by the golden tests (server/ai-analysis.test.ts), one per demo project.
//
//   npx tsx scripts/make-analysis-fixtures.ts        (or: npm run ai:fixtures)
//
// Until slice E2 there is no live model to record, so each reply is written in the model's output format from what the
// demo transcripts contain: the same quotes, with the wording of a model's titles and descriptions. They prove the prompt, the
// format and the grounding checks work end to end. E2 replaces them with real recordings. Run this again if the demo data changes.
import { mkdirSync, writeFileSync } from 'node:fs'
import { analyze } from '../shared/providers.mjs'
import { EFFORT, THEMES } from '../shared/stub-config.mjs'
import { buildAnalysisPrompt, loadAnalysisInput } from '../server/ai-analysis.js'
import { createDemoDatabase } from '../server/test-utils.js'

const DEMO_PROJECTS: Record<string, string> = {
  p1: 'Clinic booking, usability round 1',
  p2: 'Clinic booking, round 2',
  p3: 'Check-in diary study',
}

// The model's own wording for each prototype theme.
const WORDING: Record<string, { title: string; description: string; opportunity: string }> = {
  t1: { title: 'Finding open appointment times across providers takes too many steps', description: "Participants could not tell who was free this week from the results list and had to open each provider's profile one at a time to look for an opening.", opportunity: 'Show open times for each provider in search results, with a combined calendar view.' },
  t2: { title: 'Coverage and copay are unclear until late in the booking', description: "Participants wanted to know up front whether a provider takes their insurance and what the visit would cost, and left the app to check their insurer's portal.", opportunity: 'Show in-network status and an estimated copay on each provider card.' },
  t3: { title: 'Ratings and recommendations decide who participants consider', description: 'Participants screen providers on star ratings and on whether friends recommend them before they look at availability.', opportunity: 'Keep ratings prominent in results and make recommendations visible.' },
  t4: { title: 'The booking form asks for information the app already has', description: 'Participants entered details they had already given, such as name and contact information, and found the form repetitive.', opportunity: 'Prefill the form from the profile and remember family members.' },
  t5: { title: 'Fees appear late and the total is higher than the listing', description: 'Participants were surprised at confirmation by a total above the price they had seen on the listing.', opportunity: 'Include every fee in the first listed price.' },
  t6: { title: 'Reminders help participants feel prepared', description: 'Participants said the text reminder before the visit made them confident they would not forget it.', opportunity: 'Extend reminders with directions and a preparation checklist.' },
  t7: { title: 'Participants want to know what to bring or prepare', description: 'Participants asked what paperwork or steps they needed before arriving, and some made a second trip.', opportunity: 'Send a visit-specific checklist after booking.' },
  t8: { title: 'Moving an appointment means calling the clinic', description: 'Participants could not reschedule or cancel in the app and had to phone the clinic during office hours.', opportunity: 'Add self-serve reschedule and cancel with clear change windows.' },
  t9: { title: 'Follow-up instructions are easy to lose', description: 'Participants said instructions given after the visit were hard to find later.', opportunity: 'Keep the visit summary and follow-up plan in the app.' },
}
const CATEGORY: Record<string, string> = { 'Pain point': 'pain_point', Need: 'need', Expectation: 'expectation', Delight: 'delight' }

const { db } = await createDemoDatabase()
mkdirSync(new URL('../server/fixtures/analysis/', import.meta.url), { recursive: true })
for (const [key, name] of Object.entries(DEMO_PROJECTS)) {
  const id = (await db.query(`select id from core.projects where name = $1`, [name])).rows[0].id as string
  const input = await loadAnalysisInput(db, id)
  const { index } = buildAnalysisPrompt(input)
  const themes = analyze(input.transcripts, input.participants, THEMES, EFFORT).map((th) => ({
    title: WORDING[th.id].title,
    category: CATEGORY[th.cat],
    stage: th.stage + 1,
    severity: th.sev,
    description: WORDING[th.id].description,
    opportunity: WORDING[th.id].opportunity,
    effort: th.eff,
    effortNote: th.effNote,
    quotes: th.quotes.map((q) => ({ ref: `T${q.t + 1}.U${q.u + 1}`, text: index.lines.find((l) => l.t === q.t && l.u === q.u)!.masked })),
  }))
  writeFileSync(new URL(`../server/fixtures/analysis/${key}.json`, import.meta.url), JSON.stringify({ themes }, null, 2) + '\n')
  console.log(`${key}: ${name}, ${input.transcripts.length} transcripts, ${themes.length} themes`)
}
