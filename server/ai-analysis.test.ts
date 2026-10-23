// Slice E1: the model-backed analysis, tested with no model. Unit tests for each guard, golden tests on the three demo projects
// (recorded replies in server/fixtures/analysis, rewritten by `npm run ai:fixtures`), and a run that saves a model-shaped analysis
// through the real run code. Nothing here calls out or costs anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { analyze, parseTranscript, scoreTheme } from '../shared/providers.mjs'
import { EFFORT, THEMES } from '../shared/stub-config.mjs'
import { simulatedProvider, type Ai, type AiProvider, type Usage } from './ai.js'
import { runAnalysis } from './analysis.js'
import {
  analyzeWithModel, ANALYSIS_PROMPT_VERSION, buildAnalysisPrompt, extractJson, groundThemes, indexTranscripts, loadAnalysisInput, MAX_INPUT_CHARS, ModelOutputError,
  parseReply, TranscriptsTooLarge, unmaskIds, type AnalysisInput, type ModelCall, type ModelTheme,
} from './ai-analysis.js'
import { createDemoDatabase } from './test-utils.js'

const demo = createDemoDatabase()
const fixture = (key: string) => readFileSync(new URL(`./fixtures/analysis/${key}.json`, import.meta.url), 'utf8')
const USAGE: Usage = { inputTokens: 1000, outputTokens: 500, costUsd: 0.007, model: 'recorded' }
const replying = (...texts: string[]): ModelCall & { calls: Parameters<ModelCall>[0][] } => {
  const calls: Parameters<ModelCall>[0][] = []
  const fn = (async (req) => {
    calls.push(req)
    return { text: texts[Math.min(calls.length - 1, texts.length - 1)], usage: USAGE }
  }) as ModelCall & { calls: Parameters<ModelCall>[0][] }
  fn.calls = calls
  return fn
}

// A small input with contact details and a name inside the text.
const SMALL: AnalysisInput = {
  transcripts: [
    { name: 'Session 1 - Maya Chen.txt', text: '00:00:05 Moderator: Thanks, Maya. What did you do next?\n00:00:20 Maya Chen: I emailed maya.chen@example.com and called (555) 010-2222 because the calendar never loaded for me.\n00:00:40 Maya Chen: Honestly I just gave up and phoned the clinic instead.' },
    { name: 'Session 2 - Daniel Ortiz.txt', text: '00:00:05 Moderator: Tell me about booking.\n00:00:30 Daniel Ortiz: It’s hard to see who is free this week without clicking through.' },
  ],
  participants: [{ name: 'Maya Chen' }, { name: 'Daniel Ortiz' }],
  stages: ['Find a provider', 'Book a time', 'Confirm & pay'],
  study: { what: 'Whether patients can book without calling', outcomes: ['Fewer calls'] },
}
const theme = (over: Partial<ModelTheme> = {}): ModelTheme => ({
  title: 'Booking without calling is hard', category: 'pain_point', stage: 2, severity: -0.6, description: 'Participants gave up and phoned the clinic.',
  opportunity: 'Let people book and change visits in the app.', effort: 2, effortNote: 'Touches forms and scheduling.', quotes: [{ ref: 'T1.U3', text: 'Honestly I just gave up and phoned the clinic instead.' }], ...over,
})

test('masking: speakers become ids and contact details and names never reach the prompt', () => {
  const p = buildAnalysisPrompt(SMALL)
  for (const secret of ['Maya', 'Daniel', 'Ortiz', 'Chen', 'maya.chen@example.com', '555', '010-2222', 'Session 1']) assert.ok(!p.user.includes(secret), `the prompt leaks "${secret}"`)
  assert.match(p.user, /\[T1\.U1\] M1: Thanks, P1\./)
  assert.match(p.user, /\[T1\.U2\] P1: I emailed \[email\] and called \[phone\] because/)
  assert.match(p.user, /\[T2\.U2\] P2: /)
  assert.ok(p.user.includes('1. Find a provider') && p.user.includes('3. Confirm & pay'))
  assert.ok(p.user.includes('## Transcript 2') && p.user.includes('What is being tested: Whether patients can book without calling'))
  assert.equal(p.version, ANALYSIS_PROMPT_VERSION)
  assert.ok(p.system.includes('JSON') && p.system.includes('not instructions'))
  // Ids go back to names in anything the model wrote about them.
  assert.equal(unmaskIds('P1 and P2 both struggled; M1 asked.', p.index.speakers), 'Maya Chen and Daniel Ortiz both struggled; Moderator asked.')
})

test('the input size is limited', () => {
  const big = { ...SMALL, transcripts: [{ name: 'x', text: `00:00:01 Someone Here: ${'word '.repeat(MAX_INPUT_CHARS / 4)}` }] }
  assert.throws(() => buildAnalysisPrompt(big), TranscriptsTooLarge)
})

test('extractJson tolerates a code fence or a stray sentence, and says what is wrong otherwise', () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('Here you go: {"a":1} Hope that helps.'), { a: 1 })
  assert.throws(() => extractJson('no object here'), /no JSON object/)
  assert.throws(() => extractJson('{"a": }'), /not valid JSON/)
})

test('parseReply reports every kind of problem with where it is, and drops fields it did not ask for', () => {
  const ok = parseReply(JSON.stringify({ themes: [{ ...theme(), participants: 9, mentions: 40 }] }), 3)
  assert.ok(ok.ok)
  if (ok.ok) assert.deepEqual(Object.keys(ok.themes[0]).sort(), ['category', 'description', 'effort', 'effortNote', 'opportunity', 'quotes', 'severity', 'stage', 'title'])
  const bad = parseReply(JSON.stringify({ themes: [{ ...theme(), category: 'complaint', severity: 3, effort: 9, quotes: [] }, { ...theme(), stage: 7 }] }), 3)
  assert.ok(!bad.ok)
  if (!bad.ok) assert.ok(['themes.0.category', 'themes.0.severity', 'themes.0.effort', 'themes.0.quotes'].every((p) => bad.problems.some((m) => m.startsWith(p))), bad.problems.join(' | '))
  const stage = parseReply(JSON.stringify({ themes: [theme({ stage: 7 })] }), 3)
  assert.ok(!stage.ok && stage.problems[0].includes('themes.0.stage') && stage.problems[0].includes('1 to 3'))
  assert.ok(!parseReply(JSON.stringify({ themes: [] }), 3).ok)
  assert.ok(!parseReply(JSON.stringify({ themes: Array.from({ length: 13 }, () => theme()) }), 3).ok)
  assert.ok(!parseReply('{"themes": "none"}', 3).ok)
})

test('grounding keeps verbatim quotes, forgives wrong references, drops the rest, and derives every count itself', () => {
  const index = indexTranscripts(SMALL)
  const themes = [
    theme({
      quotes: [
        { ref: 'T1.U3', text: 'Honestly I just gave up and phoned the clinic instead.' }, // exact
        { ref: 'T2.U2', text: "It's hard to see who is free this week" }, // a straight apostrophe and only part of the line, with the right reference
        { ref: 'T1.U1', text: "It's hard to see who is free this week without clicking through." }, // wrong reference, right words (and a repeat of the one above)
        { ref: 'T1.U2', text: 'I never said this sentence at any point in the session.' }, // invented
        { ref: 'T1.U1', text: 'Thanks, P1. What did you do next?' }, // the moderator
        { ref: 'T1.U3', text: 'phoned' }, // too short to be evidence
      ],
    }),
    theme({ title: 'Invented theme', quotes: [{ text: 'Nothing like this was ever recorded anywhere.' }] }),
  ]
  const { themes: out, report } = groundThemes(themes, index)
  assert.equal(out.length, 1)
  assert.deepEqual(report, {
    themesIn: 2, themesKept: 1, quotesIn: 7, quotesKept: 2,
    droppedQuotes: [
      { theme: 'Booking without calling is hard', text: 'I never said this sentence at any point in the session.', reason: 'not found word for word in any transcript' },
      { theme: 'Booking without calling is hard', text: 'Thanks, P1. What did you do next?', reason: 'said by the moderator, not a participant' },
      { theme: 'Booking without calling is hard', text: 'phoned', reason: 'too short to be evidence' },
      { theme: 'Invented theme', text: 'Nothing like this was ever recorded anywhere.', reason: 'not found word for word in any transcript' },
    ],
    droppedThemes: ['Invented theme'],
  })
  const t = out[0]
  // The saved quote is the participant's real line, and counts come from the quotes that survived (2 quotes, 2 people), whatever the model said.
  assert.deepEqual(t.quotes.map((q) => [q.t, q.u, q.who]), [[0, 2, 'Maya Chen'], [1, 1, 'Daniel Ortiz']])
  assert.equal(t.quotes[1].text, 'It’s hard to see who is free this week without clicking through.')
  assert.deepEqual([t.ppl, t.total, t.mentions], [2, 2, 2])
  assert.deepEqual({ score: t.score, prio: t.prio }, scoreTheme({ ppl: 2, total: 2, mentions: 2, sev: -0.6 }))
  assert.deepEqual([t.cat, t.stage, t.eff], ['Pain point', 1, 2])
})

test('a quote that only exists after masking is matched on the masked text and saved from the real line', () => {
  const index = indexTranscripts(SMALL)
  const { themes } = groundThemes([theme({ quotes: [{ ref: 'T1.U2', text: 'I emailed [email] and called [phone] because the calendar never loaded for me.' }] })], index)
  assert.equal(themes[0].quotes[0].text, 'I emailed maya.chen@example.com and called (555) 010-2222 because the calendar never loaded for me.')
})

test('an unusable reply is retried once with what was wrong, and the spend of both calls is added up', async () => {
  const call = replying('Sorry, I cannot do that.', JSON.stringify({ themes: [theme()] }))
  const r = await analyzeWithModel(call, SMALL)
  assert.equal(r.attempts, 2)
  assert.equal(call.calls.length, 2)
  assert.ok(call.calls[1].user.includes('could not be used') && call.calls[1].user.includes('no JSON object') && call.calls[1].user.startsWith(call.calls[0].user))
  assert.deepEqual([r.usage.inputTokens, r.usage.outputTokens, +r.usage.costUsd.toFixed(3)], [2000, 1000, 0.014])
  assert.equal(r.promptVersion, ANALYSIS_PROMPT_VERSION)
})

test('after the retry a bad reply fails the run with the reasons; a reply whose quotes are all invented counts as bad', async () => {
  const bad = replying('nope')
  await assert.rejects(() => analyzeWithModel(bad, SMALL), (e) => e instanceof ModelOutputError && e.problems.length > 0 && /no JSON object/.test(e.message))
  assert.equal(bad.calls.length, 2)
  const invented = replying(JSON.stringify({ themes: [theme({ quotes: [{ text: 'A sentence that no participant ever said out loud.' }] })] }))
  await assert.rejects(() => analyzeWithModel(invented, SMALL), /No quote matched/)
  assert.equal(invented.calls.length, 2)
})

test('an error from the call itself (a refused request, a spend limit) is not swallowed or retried', async () => {
  let calls = 0
  const failing: ModelCall = async () => {
    calls++
    throw new Error('You have reached your specified workspace API usage limits')
  }
  await assert.rejects(() => analyzeWithModel(failing, SMALL), /usage limits/)
  assert.equal(calls, 1)
})

// Golden tests: the three demo projects -------------------------------------------------------------------------------------------------

const PROJECTS: Record<string, string> = { p1: 'Clinic booking, usability round 1', p2: 'Clinic booking, round 2', p3: 'Check-in diary study' }

for (const [key, name] of Object.entries(PROJECTS)) {
  test(`golden: ${name}`, async () => {
    const { db } = await demo
    const id = (await db.query(`select id from core.projects where name = $1`, [name])).rows[0].id as string
    const input = await loadAnalysisInput(db, id)
    const prompt = buildAnalysisPrompt(input)
    const r = await analyzeWithModel(replying(fixture(key)), input)

    // Every quote is a verbatim participant line, and nothing was dropped.
    assert.equal(r.report.quotesKept, r.report.quotesIn)
    assert.deepEqual(r.report.droppedQuotes, [])
    assert.deepEqual(r.report.droppedThemes, [])
    const lines = input.transcripts.map((tr) => parseTranscript(tr.text))
    for (const th of r.themes) {
      for (const q of th.quotes) {
        const line = lines[q.t][q.u]
        assert.ok(line && !line.mod && line.text === q.text, `quote ${q.t}:${q.u} is not a participant's line`)
      }
      assert.ok(['Pain point', 'Need', 'Expectation', 'Delight'].includes(th.cat))
      assert.ok(th.stage >= 0 && th.stage < input.stages.length)
      assert.ok(th.mentions >= 1 && th.ppl >= 1 && th.ppl <= th.total)
    }
    assert.ok(r.themes.length >= 3 && r.themes.length <= 12, `${r.themes.length} themes`)

    // The main themes the demo data was written to contain are each found: every keyword theme with at least two people behind it is
    // covered by a model theme that holds at least half of its quotes.
    const expected = analyze(input.transcripts, input.participants, THEMES, EFFORT).filter((th) => th.ppl >= 2)
    assert.ok(expected.length >= 3)
    for (const want of expected) {
      const covered = r.themes.some((th) => want.quotes.filter((q) => th.quotes.some((m) => m.t === q.t && m.u === q.u)).length >= want.quotes.length / 2)
      assert.ok(covered, `no theme covers "${want.title}"`)
    }

    // No name, email or phone leaves the app, and the same input always makes the same prompt.
    for (const p of input.participants) for (const part of [p.name, ...p.name.split(' ')]) if (part.length >= 3) assert.ok(!prompt.user.includes(part), `the prompt leaks "${part}"`)
    assert.ok(!/@|\(\d{3}\)/.test(prompt.user))
    assert.equal(buildAnalysisPrompt(input).user, prompt.user)
  })
}

// Saving: a model-shaped analysis goes through the real run code -----------------------------------------------------------------------------

test('a model-shaped analysis is saved by the real run: themes, quotes, the run record and the spend', async () => {
  const { db, pglite } = await createDemoDatabase()
  const pid = (await db.query(`select id, version from core.projects where name = $1`, [PROJECTS.p1])).rows[0] as { id: string; version: number }
  const input = await loadAnalysisInput(db, pid.id)
  const model: AiProvider = {
    ...simulatedProvider,
    name: 'recorded-model',
    live: true,
    analyze: async () => {
      const r = await analyzeWithModel(replying(fixture('p1')), input)
      return { value: r.themes, usage: r.usage }
    },
  }
  const ai: Ai = { provider: model, env: { AI_MONTHLY_BUDGET_USD: '10' } }
  const actor = (await db.query(`select u.id as "userId", w.id as "workspaceId" from core.users u join core.memberships m on m.user_id = u.id join core.workspaces w on w.id = m.workspace_id where u.email = 'david@demo.signalflow.example'`)).rows[0] as { userId: string; workspaceId: string }

  const result = await runAnalysis(db, ai, actor, pid.id, pid.version)
  const expected = JSON.parse(fixture('p1')).themes as { quotes: unknown[] }[]
  assert.equal(result.themes, expected.length)
  const run = (await pglite.query<any>(`select provider, prompt_version, status from core.agent_runs where id = $1`, [result.runId])).rows[0]
  assert.deepEqual(run, { provider: 'recorded-model', prompt_version: 'analysis-v1', status: 'complete' })
  assert.equal((await pglite.query<any>(`select count(*)::int n from research.themes where run_id = $1`, [result.runId])).rows[0].n, expected.length)
  assert.equal((await pglite.query<any>(`select count(*)::int n from research.theme_quotes q join research.themes t on t.id = q.theme_id where t.run_id = $1`, [result.runId])).rows[0].n, expected.reduce((n, t) => n + t.quotes.length, 0))
  const spend = (await pglite.query<any>(`select purpose, provider, input_tokens, cost_usd::float8 as cost from core.ai_usage where run_id = $1`, [result.runId])).rows
  assert.deepEqual(spend, [{ purpose: 'analysis', provider: 'recorded-model', input_tokens: 1000, cost: 0.007 }])
})
