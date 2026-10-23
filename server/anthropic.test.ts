// Slice E2: the live provider, tested against a fake network. Nothing here reaches Anthropic or costs anything.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { getProvider, makeAi } from './ai.js'
import { runAnalysis } from './analysis.js'
import { anthropicCall, anthropicProvider, costUsd, DEFAULT_ANALYSIS_MODEL, mapFailure } from './anthropic.js'
import { createProjectSpec, getSpec } from './specs.js'
import { createDemoDatabase } from './test-utils.js'

const KEY = 'sk-ant-test-key-do-not-leak'
const fixture = (key: string) => readFileSync(new URL(`./fixtures/analysis/${key}.json`, import.meta.url), 'utf8')
const ok = (text: string, input = 1000, output = 500) => new Response(JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: input, output_tokens: output } }), { status: 200 })
const fetching = (...answers: (Response | Error)[]) => {
  const calls: { url: string; init: RequestInit }[] = []
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const a = answers[Math.min(calls.length - 1, answers.length - 1)]
    if (a instanceof Error) throw a
    return a.clone()
  }) as unknown as typeof fetch & { calls: typeof calls }
  fn.calls = calls
  return fn
}

test('the provider is only live with a key and AI_PROVIDER=anthropic', () => {
  assert.equal(getProvider({ AI_PROVIDER: 'anthropic' }).live, false, 'no key: stays simulated')
  assert.equal(getProvider({ ANTHROPIC_API_KEY: KEY }).live, false, 'no AI_PROVIDER: stays simulated')
  assert.equal(getProvider({ ANTHROPIC_API_KEY: KEY, AI_PROVIDER: 'anthropic', AI_ENABLED: 'false' }).live, false, 'kill switch wins')
  assert.equal(getProvider({ ANTHROPIC_API_KEY: KEY, AI_PROVIDER: 'anthropic' }).name, 'anthropic')
})

test('prices are per million tokens', () => {
  assert.equal(costUsd('claude-sonnet-5-5', 1_000_000, 1_000_000), 12)
  assert.equal(costUsd('claude-haiku-5-5', 1_000_000, 1_000_000), 0.6)
  assert.equal(costUsd('unknown', 1000, 1000), 0)
})

test('a call sends the key and prompt to the Messages API and prices the reply from its token counts', async () => {
  const f = fetching(ok('hello', 20_000, 2_000))
  const reply = await anthropicCall({ ANTHROPIC_API_KEY: KEY }, DEFAULT_ANALYSIS_MODEL, f)({ system: 'SYS', user: 'USER', maxTokens: 4000 })
  assert.equal(reply.text, 'hello')
  assert.deepEqual(reply.usage, { inputTokens: 20_000, outputTokens: 2_000, costUsd: 0.06, model: DEFAULT_ANALYSIS_MODEL })
  const { url, init } = f.calls[0]
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  assert.equal((init.headers as Record<string, string>)['x-api-key'], KEY)
  assert.deepEqual(JSON.parse(init.body as string), { model: DEFAULT_ANALYSIS_MODEL, max_tokens: 4000, system: 'SYS', messages: [{ role: 'user', content: 'USER' }] })
})

test('failures become plain 503s with a code, never retried, and never echo the response or the key', async () => {
  const cases: [number, string, string][] = [
    [400, 'Your credit balance is too low to access the Anthropic API', 'ai_credit_exhausted'],
    [400, 'You have reached your specified API usage limits', 'ai_credit_exhausted'],
    [429, '{"details":{"error_code":"enforced_spend_limit_reached"}}', 'ai_rate_limited'],
    [401, 'invalid x-api-key', 'ai_not_configured'],
    [529, 'overloaded', 'ai_unreachable'],
    [400, 'prompt is too long', 'ai_request_rejected'],
  ]
  for (const [status, body, code] of cases) {
    const f = fetching(new Response(`${body} ${KEY}`, { status }))
    await assert.rejects(anthropicCall({ ANTHROPIC_API_KEY: KEY }, DEFAULT_ANALYSIS_MODEL, f)({ system: '', user: '', maxTokens: 1 }), (e: any) => {
      assert.equal(e.status, 503)
      assert.equal(e.code, code)
      assert.ok(!e.message.includes(KEY) && !e.message.includes(body))
      return true
    })
    assert.equal(f.calls.length, 1, `${status} was not retried`)
  }
  await assert.rejects(anthropicCall({ ANTHROPIC_API_KEY: KEY }, DEFAULT_ANALYSIS_MODEL, fetching(new Error('socket hang up')))({ system: '', user: '', maxTokens: 1 }), (e: any) => e.code === 'ai_unreachable')
  assert.equal(mapFailure(400, 'x').code, 'ai_request_rejected')
})

async function setup(project = 'Clinic booking, usability round 1') {
  const { db, pglite } = await createDemoDatabase()
  const pid = (await db.query(`select id, version from core.projects where name = $1`, [project])).rows[0] as { id: string; version: number }
  const actor = (await db.query(`select u.id as "userId", w.id as "workspaceId" from core.users u join core.memberships m on m.user_id = u.id join core.workspaces w on w.id = m.workspace_id where u.email = 'david@demo.signalflow.example'`)).rows[0] as { userId: string; workspaceId: string }
  return { db, pglite, pid, actor }
}
const envFor = (f: typeof fetch) => ({ env: { AI_MONTHLY_BUDGET_USD: '5', ANTHROPIC_API_KEY: KEY }, provider: anthropicProvider({ ANTHROPIC_API_KEY: KEY }, f)! })

test('a full run through the live provider saves a grounded analysis and the real spend', async () => {
  const { db, pglite, pid, actor } = await setup()
  const f = fetching(ok(fixture('p1'), 18_000, 3_000))
  const { env, provider } = envFor(f)
  const result = await runAnalysis(db, makeAi(env, provider), actor, pid.id, pid.version)
  assert.ok(result.themes > 0)
  assert.equal(f.calls.length, 1)
  const run = (await pglite.query<any>(`select provider, prompt_version, status from core.agent_runs where id = $1`, [result.runId])).rows[0]
  assert.deepEqual(run, { provider: 'anthropic', prompt_version: 'analysis-v1', status: 'complete' })
  const spend = (await pglite.query<any>(`select purpose, provider, model, input_tokens, output_tokens, cost_usd::float8 as cost from core.ai_usage`)).rows
  assert.deepEqual(spend, [{ purpose: 'analysis', provider: 'anthropic', model: DEFAULT_ANALYSIS_MODEL, input_tokens: 18_000, output_tokens: 3_000, cost: 0.066 }])
  const sent = JSON.parse(f.calls[0].init.body as string)
  assert.ok(!/@|\(\d{3}\)/.test(sent.messages[0].content), 'no contact details leave the app')
})

test('an unusable reply fails the run, keeps the current analysis, and still records what the two calls cost', async () => {
  const { db, pglite, pid, actor } = await setup()
  const { env, provider } = envFor(fetching(ok('not json', 1000, 100)))
  await assert.rejects(runAnalysis(db, makeAi(env, provider), actor, pid.id, pid.version), (e: any) => e.status === 503 && e.code === 'ai_output_unusable')
  const status = (await pglite.query<any>(`select status::text s from core.agent_runs where project_id = $1 order by started_at desc limit 1`, [pid.id])).rows[0].s
  assert.equal(status, 'failed')
  const spend = (await pglite.query<any>(`select count(*)::int n, sum(input_tokens)::int i from core.ai_usage`)).rows[0]
  assert.deepEqual(spend, { n: 1, i: 2000 })
})

test('when the account is out of credit the run falls back to the simulation and says so', async () => {
  const { db, pglite, pid, actor } = await setup()
  const { env, provider } = envFor(fetching(new Response('Your credit balance is too low', { status: 400 })))
  const result = await runAnalysis(db, makeAi(env, provider), actor, pid.id, pid.version)
  assert.equal(result.fallback, 'credit')
  assert.ok(result.themes > 0)
  assert.deepEqual((await pglite.query<any>(`select provider, prompt_version, status::text s from core.agent_runs where id = $1`, [result.runId])).rows[0], { provider: 'stub', prompt_version: 'keyword-v1', s: 'complete' })
  assert.equal((await pglite.query<any>(`select count(*)::int n from core.ai_usage`)).rows[0].n, 0)
})

test('other provider failures mark the run failed and record nothing', async () => {
  const { db, pglite, pid, actor } = await setup()
  const { env, provider } = envFor(fetching(new Response('invalid x-api-key', { status: 401 })))
  await assert.rejects(runAnalysis(db, makeAi(env, provider), actor, pid.id, pid.version), (e: any) => e.code === 'ai_not_configured')
  assert.equal((await pglite.query<any>(`select count(*)::int n from core.ai_usage`)).rows[0].n, 0)
  assert.equal((await pglite.query<any>(`select count(*)::int n from core.agent_runs where project_id = $1 and status = 'running'`, [pid.id])).rows[0].n, 0)
})

test('drafting a requirements step goes through the live provider: one call, priced, saved with its evidence', async () => {
  const { db, pglite, pid, actor } = await setup('Clinic booking, round 2')
  const reply = JSON.stringify({ reasoning: 'Participants met costs late in booking, the clearest barrier in the research.', text: 'Fees and coverage appear too late in booking.', evidence: ['T1'], alternatives: [] })
  const f = fetching(ok(reply, 2_000, 400))
  const { env, provider } = envFor(f)
  const specId = await createProjectSpec(db, makeAi(env, provider), actor, pid.id)
  assert.equal(f.calls.length, 1)
  const body = JSON.parse(f.calls[0].init.body as string)
  assert.equal(body.model, DEFAULT_ANALYSIS_MODEL)
  assert.match(body.messages[0].content, /Step 1 of 8: Frame the problem/)
  const spend = (await pglite.query<any>(`select purpose, provider, input_tokens, cost_usd::float8 as cost from core.ai_usage`)).rows
  assert.deepEqual(spend, [{ purpose: 'spec_step', provider: 'anthropic', input_tokens: 2_000, cost: 0.008 }])
  const spec = (await getSpec(db, actor.workspaceId, specId))!
  assert.equal(spec.steps[0].status, 'review')
  assert.equal(spec.steps[0].evidence.length, 1)
})
