// The Storyboard: the model's reply is checked against the figures it was given, the text is saved once and read by everyone, and only owners
// and editors generate it. No model is called.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { simulatedProvider, type AiProvider } from './ai.js'
import { ModelOutputError, type ModelCall } from './ai-analysis.js'
import { buildStoryboardPrompt, parseStoryboard, storyboardWithModel, templateStoryboard, type StoryboardInput } from './ai-storyboard.js'
import { createDemoDatabase } from './test-utils.js'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const TOKEN = 's3cret'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }

const INPUT: StoryboardInput = {
  projectName: 'Renewal workspace',
  participants: 13,
  roles: [{ role: 'Customer Success Manager', count: 9 }, { role: 'Support Lead', count: 4 }],
  tasks: ['Prepare for a customer call'],
  themes: [
    { id: 'a', title: 'Risk signals are spread across tools', category: 'pain_point', participants: 9, totalParticipants: 13, description: 'Checks three tools before a call', opportunity: null, quotes: ['I check the CRM and the queue and still miss things. Call me on 555-123-4567.'] },
    { id: 'b', title: 'Health scores are not trusted', category: 'pain_point', participants: 7, totalParticipants: 13, description: null, opportunity: null, quotes: [] },
  ],
}
const solution = (themes: string[], extra: Record<string, string> = {}) => ({
  name: 'Account risk timeline', description: 'Bring renewal dates and support activity into one timeline per account.', themes,
  benefit: 'High: risk shows up early, in one place', cost: 'Medium: depends on the CRM data', risk: 'Medium: depends on data quality', giveUp: 'Custom score weights in the first release', alternatives: 'More integrations on the current dashboard', ...extra,
})
const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    headline: 'Seeing account risk before the renewal conversation',
    problem: 'Customer success managers cannot see account risk until the renewal is already difficult.',
    solutions: [solution(['T1', 't2'])],
    recommendation: { direction: 'Start with the account risk timeline: it answers the theme the most people raised.', decision: 'Agree to build the timeline first.', nextStep: 'Prioritize with engineering.' },
    ...over,
  })
const replying = (...texts: string[]): ModelCall & { calls: Parameters<ModelCall>[0][] } => {
  const calls: Parameters<ModelCall>[0][] = []
  const fn = (async (req) => {
    calls.push(req)
    return { text: texts[Math.min(calls.length - 1, texts.length - 1)], usage: { inputTokens: 900, outputTokens: 600, costUsd: 0.004, model: 'fake-sonnet' } }
  }) as ModelCall & { calls: Parameters<ModelCall>[0][] }
  fn.calls = calls
  return fn
}

test('a storyboard reply cites themes by number, may use only the figures it was given, and keeps every part', () => {
  const ok = parseStoryboard(reply(), INPUT)
  assert.ok(ok.ok)
  assert.deepEqual((ok as any).draft.solutions[0].themes, ['a', 'b'], 'T1 and t2 become the theme ids')
  const unknownTheme = parseStoryboard(reply({ solutions: [solution(['T9'])] }), INPUT)
  assert.ok(!unknownTheme.ok)
  assert.match((unknownTheme as any).problems[0], /T9/)
  const wrongFigure = parseStoryboard(reply({ problem: 'Customer success managers cannot see risk: 11 of 13 participants said so.' }), INPUT)
  assert.ok(!wrongFigure.ok)
  assert.match((wrongFigure as any).problems[0], /11 of 13/)
  assert.ok(parseStoryboard(reply({ problem: 'Customer success managers cannot see risk: 9 of 13 participants said so.' }), INPUT).ok)
  assert.ok(!parseStoryboard(reply({ solutions: [] }), INPUT).ok, 'at least one solution')
  assert.ok(!parseStoryboard(reply({ solutions: [1, 2, 3, 4].map(() => solution(['T1'])) }), INPUT).ok, 'no more than three')
  assert.ok(!parseStoryboard(JSON.stringify({ headline: 'Only a headline here' }), INPUT).ok)
})

test('the prompt masks contact details, calls the research data, and a wrong reply is retried once with the problem quoted', async () => {
  const p = buildStoryboardPrompt(INPUT)
  assert.ok(!/555-123-4567/.test(p.user) && /\[phone\]/.test(p.user))
  assert.match(p.user, /T1: "Risk signals are spread across tools" \| pain point \| 9 of 13 participants/)
  assert.match(p.system, /best guesses/)
  const call = replying(reply({ solutions: [solution(['T7'])] }), reply())
  const r = await storyboardWithModel(call, INPUT)
  assert.equal(r.attempts, 2)
  assert.match(call.calls[1].user, /T7/)
  assert.equal(r.usage.costUsd, 0.008, 'both calls are paid for')
  await assert.rejects(storyboardWithModel(replying('not json at all'), INPUT), ModelOutputError)
})

test('the plain draft names the strongest themes and leaves the judgments to the model', () => {
  const t = templateStoryboard(INPUT)
  assert.equal(t.solutions.length, 2)
  assert.deepEqual(t.solutions.map((s) => s.themes), [['a'], ['b']])
  assert.match(t.solutions[0].cost, /without the AI model/)
  assert.match(t.problem, /9 of 13 participants/)
  assert.ok(t.solutions.every((s) => s.name.length <= 60))
  assert.deepEqual(templateStoryboard({ ...INPUT, themes: [] }).solutions, [])
})

async function fixture(provider?: AiProvider, env: Record<string, string> = {}) {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  const app = createApp({ env: { DEV_TOKEN: TOKEN, ...env }, getDb: () => db, provider })
  const api = (path: string, method = 'GET', headers: Record<string, string> = auth) => app.request('/api/v1' + path, { method, headers })
  const projectId = ((await (await api('/projects')).json()).data as any[]).find((p) => p.name === 'Health score trust').id as string
  return { pg, app, api, projectId }
}

const fakeModel = (calls: { n: number } = { n: 0 }): AiProvider => ({
  ...simulatedProvider,
  name: 'fake-model',
  live: true,
  writeStoryboard: async (input) => {
    calls.n++
    return {
      value: {
        draft: {
          headline: 'Seeing risk before the renewal', problem: `People most often raised ${input.themes[0].title.toLowerCase()}.`,
          solutions: [{ name: 'Account risk timeline', description: 'One timeline per account, with early warnings.', themes: [input.themes[0].id, 'gone'], benefit: 'High: risk shows early', cost: 'Medium: depends on data', risk: 'Medium: depends on adoption', giveUp: 'Custom weights', alternatives: 'More dashboards' }],
          recommendation: { direction: 'Start with the timeline because it answers the strongest theme.', decision: 'Agree to build it first.', nextStep: 'Prioritize with engineering.' },
        },
        promptVersion: 'test-v1',
      },
      usage: { inputTokens: 900, outputTokens: 600, costUsd: 0.004, model: 'fake-sonnet' },
    }
  },
})

test('the storyboard is the live facts until someone generates it, and then the saved text is the same for everyone', async () => {
  const calls = { n: 0 }
  const m = await fixture(fakeModel(calls))
  const before = await (await m.api(`/projects/${m.projectId}/storyboard`)).json()
  assert.equal(before.draft, null)
  assert.equal(before.facts.projectName, 'Health score trust')
  assert.equal(before.facts.participants, 4)
  assert.ok(before.facts.themes.length > 0 && before.facts.themes.length <= 8 && before.facts.themeCount >= before.facts.themes.length)
  assert.ok(before.facts.themes.every((t: any) => t.totalParticipants === 4))
  const quoted = before.facts.themes.filter((t: any) => t.quote)
  assert.ok(quoted.length > 0 && quoted.every((t: any) => before.facts.roles.some((r: any) => r.role === t.quote.who)), 'a quote is credited to a role, never a name')
  assert.ok(before.facts.roles.length > 0 && before.facts.tasks.length > 0)

  const made = await m.api(`/projects/${m.projectId}/storyboard/generate`, 'POST')
  assert.equal(made.status, 200)
  const body = await made.json()
  assert.equal(body.draft.source, 'model')
  assert.equal(body.draft.headline, 'Seeing risk before the renewal')
  assert.deepEqual(body.draft.solutions[0].themes, [{ id: before.facts.themes[0].id, title: before.facts.themes[0].title }], 'a theme that is not in the project is dropped from the chips')
  assert.equal(calls.n, 1)
  assert.equal((await m.pg.query<any>(`select count(*)::int n from core.ai_usage where purpose = 'storyboard'`)).rows[0].n, 1, 'recorded under AI usage and costs')

  const again = await (await m.api(`/projects/${m.projectId}/storyboard`)).json()
  assert.deepEqual(again.draft, body.draft, 'reading does not call the model')
  assert.equal(calls.n, 1)
  await m.api(`/projects/${m.projectId}/storyboard/generate`, 'POST')
  assert.equal(calls.n, 2, 'generating again replaces the text')
  assert.equal((await m.pg.query<any>(`select count(*)::int n from research.storyboards`)).rows[0].n, 1, 'still one per project')
})

test('an analysis writes the storyboard by itself, and a failure to write it leaves the analysis saved', async () => {
  const calls = { n: 0 }
  const m = await fixture(fakeModel(calls))
  const version = async () => (await m.pg.query<any>(`select version from core.projects where id = $1`, [m.projectId])).rows[0].version as number
  const analyze = async () => m.app.request(`/api/v1/projects/${m.projectId}/analysis-runs`, { method: 'POST', headers: { ...auth, 'if-match': String(await version()) }, body: '{}' })
  const first = await analyze()
  assert.equal(first.status, 201)
  assert.equal(calls.n, 1, 'the deck is written once the themes are saved')
  const board = await (await m.api(`/projects/${m.projectId}/storyboard`)).json()
  assert.equal(board.draft?.headline, 'Seeing risk before the renewal')
  await analyze()
  assert.equal(calls.n, 2, 'analysing again writes it again')
  const broken = { ...fakeModel({ n: 0 }), writeStoryboard: async () => { throw new Error('model down') } } as AiProvider
  const b = await fixture(broken)
  const v = (await b.pg.query<any>(`select version from core.projects where id = $1`, [b.projectId])).rows[0].version
  const res = await b.app.request(`/api/v1/projects/${b.projectId}/analysis-runs`, { method: 'POST', headers: { ...auth, 'if-match': String(v) }, body: '{}' })
  assert.ok(res.status < 300, 'the analysis itself succeeded')
})

test('with no model the plain draft is saved and marked as such; a viewer may read but not generate', async () => {
  const m = await fixture()
  const made = await (await m.api(`/projects/${m.projectId}/storyboard/generate`, 'POST')).json()
  assert.equal(made.draft.source, 'template')
  assert.ok(made.draft.solutions.length > 0)
  assert.equal((await m.api(`/projects/${m.projectId}/storyboard`, 'GET', {})).status, 200, 'open to read as the demo viewer')
  assert.equal((await m.api(`/projects/${m.projectId}/storyboard/generate`, 'POST', {})).status, 401)
  assert.equal((await m.api(`/projects/00000000-0000-4000-8000-000000000000/storyboard`)).status, 404)
})

test('a project with no themes cannot be generated, and a reply that cannot be used saves nothing', async () => {
  const m = await fixture()
  const made = await m.app.request('/api/v1/projects', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'Brand new', methods: ['User Discussions'], description: null, participants: [{ name: 'Ada', email: 'ada@example.com' }] }) })
  assert.equal(made.status, 201)
  const empty = await made.json()
  assert.equal((await (await m.api(`/projects/${empty.id}/storyboard`)).json()).draft, null)
  const refused = await m.api(`/projects/${empty.id}/storyboard/generate`, 'POST')
  assert.equal(refused.status, 409)
  assert.equal((await refused.json()).error.code, 'no_themes')
  const broken = await fixture({ ...simulatedProvider, name: 'broken', live: true, writeStoryboard: async () => { throw new ModelOutputError(['bad json']) } })
  const res = await broken.api(`/projects/${broken.projectId}/storyboard/generate`, 'POST')
  assert.equal(res.status, 503)
  assert.equal((await broken.pg.query<any>(`select count(*)::int n from research.storyboards`)).rows[0].n, 0)
})
