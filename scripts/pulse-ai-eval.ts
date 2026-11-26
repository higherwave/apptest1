// Judge the AI grouping of Pulse topics by eye, before anything is switched on. Nothing is read from or written to a database.
//
//   npx tsx scripts/pulse-ai-eval.ts --prompt     prints the exact prompt that would be sent (no key needed, nothing is sent)
//   ANTHROPIC_API_KEY=... npx tsx scripts/pulse-ai-eval.ts    sends the Anchor CX sample signals to the model once and prints, side by side,
//                                                              the built-in word-overlap grouping and the model's: groups, titles, signals left out,
//                                                              and how often the model's kind agrees with the kind written beside each sample (the answer key).
//   AI_TOPIC_MODEL=claude-haiku-5-5 ...                        tries the cheaper model.
//
// One call costs a few cents at most (about 18 short signals). The key is read from the environment only and never printed.
import { SAMPLES } from './demo-pulse-signals.js'
import { anthropicCall, DEFAULT_ANALYSIS_MODEL, PRICES } from '../server/anthropic.js'
import { buildPulsePrompt, groupWithModel, type PulseGroupInput } from '../server/ai-pulse-topics.js'
import { simulateGrouping } from '../server/pulse-topics.js'

const channel = (s: { source: string }) => (s.source === 'slack' ? 'Slack' : 'Call notes')
const input: PulseGroupInput = {
  mode: 'regroup',
  topics: [],
  signals: SAMPLES.map((s, i) => ({ id: `s${i}`, body: s.body, channel: channel(s) })),
}
const short = (id: string) => SAMPLES[Number(id.slice(1))].body.slice(0, 95) + (SAMPLES[Number(id.slice(1))].body.length > 95 ? '…' : '')
const show = (title: string, groups: { title: string; ids: string[] }[], all: string[]) => {
  console.log(`\n=== ${title}: ${groups.length} topics ===`)
  for (const g of groups) {
    console.log(`\n  ${g.title}  (${g.ids.length})`)
    for (const id of g.ids) console.log(`    - ${short(id)}`)
  }
  const left = all.filter((id) => !groups.some((g) => g.ids.includes(id)))
  console.log(`\n  Left out (${left.length})`)
  for (const id of left) console.log(`    - ${short(id)}`)
}

if (process.argv.includes('--prompt')) {
  const p = buildPulsePrompt(input)
  console.log(`--- system ---\n${p.system}\n\n--- user ---\n${p.user}\n\n(max output tokens ${p.maxTokens}, prompt ${p.version})`)
  process.exit(0)
}

const all = input.signals.map((s) => s.id)
show('Built-in word matching (simulation)', simulateGrouping(input).groups, all)

const env = process.env as Record<string, string | undefined>
if (!env.ANTHROPIC_API_KEY) {
  console.log('\nNo ANTHROPIC_API_KEY in the environment, so the model was not called. Use --prompt to see what would be sent.')
  process.exit(0)
}
const model = env.AI_TOPIC_MODEL && PRICES[env.AI_TOPIC_MODEL] ? env.AI_TOPIC_MODEL : DEFAULT_ANALYSIS_MODEL
const r = await groupWithModel(anthropicCall(env, model), input)
show(`${model}`, r.output.groups, all)
const answers = new Map(r.output.kinds.map((k) => [k.signalId, k.kind]))
const agree = SAMPLES.filter((s, i) => answers.get(`s${i}`) === s.kind).length
console.log(`\nKinds: the model agrees with the answer key on ${agree} of ${SAMPLES.length}.`)
for (const [i, s] of SAMPLES.entries()) if (answers.get(`s${i}`) !== s.kind) console.log(`  key: ${s.kind.padEnd(9)} model: ${(answers.get(`s${i}`) ?? '-').padEnd(9)} ${short(`s${i}`)}`)
console.log(`\nCost: $${r.usage.costUsd.toFixed(4)} (${r.usage.inputTokens} in, ${r.usage.outputTokens} out, ${r.attempts} attempt${r.attempts === 1 ? '' : 's'}).`)
