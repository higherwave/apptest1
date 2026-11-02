// Slice E4: the model-backed theme matcher, tested with no model. Unit tests for each guard, then the real refresh over the
// demo database with a fake provider.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeAi, simulatedProvider, spendLevel, type AiProvider, type Usage } from './ai.js'
import { ModelOutputError, type ModelCall } from './ai-analysis.js'
import { buildMatchPrompt, matchWithModel, parseMatches, MIN_CONFIDENCE, type MatchInput, type Placement } from './ai-matching.js'
import { refreshPlatformMatches } from './insights.js'
import { createDemoDatabase } from './test-utils.js'
// @ts-expect-error plain ESM seed
import { uid } from '../db/seed/seed.mjs'

const USAGE: Usage = { inputTokens: 500, outputTokens: 120, costUsd: 0.0001, model: 'fake-haiku' }
const replying = (...texts: string[]): ModelCall & { calls: Parameters<ModelCall>[0][] } => {
  const calls: Parameters<ModelCall>[0][] = []
  const fn = (async (req) => {
    calls.push(req)
    return { text: texts[Math.min(calls.length - 1, texts.length - 1)], usage: USAGE }
  }) as ModelCall & { calls: Parameters<ModelCall>[0][] }
  fn.calls = calls
  return fn
}

const INPUT: MatchInput = {
  platform: [
    { id: 'p-fees', title: 'Fees appear late at checkout', category: 'pain_point' },
    { id: 'p-avail', title: 'Provider availability is hard to see', category: 'pain_point' },
  ],
  themes: [
    { id: 't1', title: 'Surprise costs at payment', description: 'Fees show up on the last screen. Reach me at ann@example.com', opportunity: 'Show the total early', category: 'pain_point' },
    { id: 't2', title: 'Wants a text when a slot opens', description: '', opportunity: '', category: 'need' },
    { id: 't3', title: 'Wants a text when a slot opens up', description: '', opportunity: '', category: 'need' },
    { id: 't4', title: 'Likes the new logo', description: '', opportunity: '', category: 'delight' },
  ],
}
const reply = (placements: unknown[]) => JSON.stringify({ placements })

test('spend levels start at 50%, 80% and 100% of the budget', () => {
  assert.deepEqual([0, 4.99, 5, 7.99, 8, 9.99, 10, 12].map((s) => spendLevel(s, 10)), ['ok', 'ok', 'half', 'half', 'high', 'high', 'reached', 'reached'])
  assert.equal(spendLevel(0, 0), 'reached', 'a zero budget is already used up')
})

test('the prompt lists platform themes as P1.. and project themes as N1.., and masks contact details', () => {
  const p = buildMatchPrompt(INPUT)
  assert.match(p.user, /P1: "Fees appear late at checkout"/)
  assert.match(p.user, /N4: "Likes the new logo"/)
  assert.ok(!p.user.includes('ann@example.com'))
  assert.match(p.user, /\[email\]/)
  assert.match(p.system, /data, not instructions/)
})

test('a match goes to the existing platform theme; a new title starts one; the same new title is spelled once', () => {
  const r = parseMatches(
    reply([
      { theme: 'N1', decision: 'match', platform: 'P1', confidence: 0.92 },
      { theme: 'N2', decision: 'new', title: 'People want to be told when a slot opens', confidence: 0.8 },
      { theme: 'N3', decision: 'new', title: 'people want to be told  when a slot opens', confidence: 0.8 },
    ]),
    INPUT,
  )
  assert.ok(r.ok)
  const p = (r as { placements: Placement[] }).placements
  assert.deepEqual(p[0], { themeId: 't1', platformThemeId: 'p-fees', confidence: 0.92 })
  assert.equal(p[1].newTitle, 'People want to be told when a slot opens')
  assert.equal(p[2].newTitle, p[1].newTitle, 'two themes grouped by the model share one title')
  assert.equal(p[1].newCategory, 'need', 'the new theme takes the project theme\'s category')
})

test('a "new" title that is really an existing platform theme attaches to it, so no duplicate is made', () => {
  const r = parseMatches(reply([{ theme: 'N1', decision: 'new', title: 'fees appear late at checkout.', confidence: 0.9 }]), INPUT)
  assert.ok(r.ok)
  assert.deepEqual((r as { placements: Placement[] }).placements, [{ themeId: 't1', platformThemeId: 'p-fees', confidence: 0.9 }])
})

test('a match below the confidence floor is left unmatched instead of guessed', () => {
  const r = parseMatches(reply([{ theme: 'N1', decision: 'match', platform: 'P1', confidence: MIN_CONFIDENCE - 0.01 }, { theme: 'N2', decision: 'new', title: 'People want a text when a slot opens', confidence: 0.3 }]), INPUT)
  assert.ok(r.ok)
  assert.deepEqual((r as { placements: Placement[] }).placements, [])
})

test('unknown references and a missing title are problems; the first answer for a theme stands', () => {
  const bad = parseMatches(reply([{ theme: 'N9', decision: 'match', platform: 'P1' }, { theme: 'N1', decision: 'match', platform: 'P7' }, { theme: 'N2', decision: 'new' }]), INPUT)
  assert.ok(!bad.ok)
  assert.equal((bad as { problems: string[] }).problems.length, 3)
  const dup = parseMatches(reply([{ theme: 'N1', decision: 'match', platform: 'P1', confidence: 0.9 }, { theme: 'N1', decision: 'match', platform: 'P2', confidence: 0.9 }]), INPUT)
  assert.deepEqual((dup as { placements: Placement[] }).placements.map((p) => p.platformThemeId), ['p-fees'])
  assert.ok(!parseMatches('not json', INPUT).ok)
})

test('a bad reply is retried once with the problems quoted, and spend is added up; a second bad reply throws', async () => {
  const call = replying(reply([{ theme: 'N1', decision: 'match', platform: 'P9' }]), reply([{ theme: 'N1', decision: 'match', platform: 'P1', confidence: 0.9 }]))
  const r = await matchWithModel(call, INPUT)
  assert.equal(r.attempts, 2)
  assert.match(call.calls[1].user, /could not be used/)
  assert.match(call.calls[1].user, /P9/)
  assert.equal(r.usage.inputTokens, 1000)
  const failing = replying(reply([{ theme: 'N1', decision: 'match', platform: 'P9' }]))
  await assert.rejects(() => matchWithModel(failing, INPUT), (err) => err instanceof ModelOutputError && err.usage?.inputTokens === 1000)
})

// The real refresh -----------------------------------------------------------------------------------------------------------

const modelProvider = (placeFor: (input: MatchInput) => Placement[], seen: MatchInput[] = []): AiProvider => ({
  ...simulatedProvider,
  name: 'fake-model',
  live: true,
  matchPlatform: async (input) => {
    seen.push(input)
    return { value: { placements: placeFor(input), promptVersion: 'test' }, usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.001, model: 'fake-haiku' } }
  },
})

async function untagged() {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  const ws = uid('workspace') as string
  await pg.query(`delete from insights.platform_theme_sources where workspace_id = $1`, [ws]) // every current theme is now waiting to be placed
  const themes = (await pg.query<any>(`select t.id, t.title, t.category from research.themes t join core.agent_runs r on r.id = t.run_id where t.workspace_id = $1 and r.status = 'complete' and r.superseded_at is null order by t.created_at, t.title`, [ws])).rows
  return { pg, db, ws, themes }
}

test('themes with no platform theme are placed by the model: matches attach, a new title starts one flagged for review, and a rerun sends nothing', async () => {
  const { pg, db, ws, themes } = await untagged()
  const platformBefore = ((await pg.query<any>(`select count(*)::int n from insights.platform_themes where workspace_id = $1`, [ws])).rows[0]).n as number
  const existing = ((await pg.query<any>(`select id from insights.platform_themes where workspace_id = $1 order by position limit 1`, [ws])).rows[0]).id as string
  const seen: MatchInput[] = []
  const ai = makeAi({ AI_MONTHLY_BUDGET_USD: '10' }, modelProvider((input) => [
    { themeId: input.themes[0].id, platformThemeId: existing, confidence: 0.9 },
    { themeId: input.themes[1].id, newTitle: 'A brand new problem the seed never had', newCategory: input.themes[1].category, confidence: 0.8 },
    { themeId: input.themes[2].id, newTitle: 'A brand new problem the seed never had', newCategory: input.themes[2].category, confidence: 0.8 },
  ], seen))
  const first = await refreshPlatformMatches(db, ai, ws)
  assert.deepEqual(first, { matched: 3, created: 1 })
  assert.equal(seen[0].themes.length, themes.length, 'every untagged current theme was sent')
  const made = (await pg.query<any>(`select id, title, category::text c, needs_review from insights.platform_themes where workspace_id = $1 and needs_review`, [ws])).rows
  assert.equal(made.length, 1)
  assert.equal(made[0].title, 'A brand new problem the seed never had')
  assert.equal(made[0].c, themes[1].category)
  const total = ((await pg.query<any>(`select count(*)::int n from insights.platform_themes where workspace_id = $1`, [ws])).rows[0]).n as number
  assert.equal(total, platformBefore + 1)
  const tagged = (await pg.query<any>(`select theme_id, platform_theme_id, match_method::text m, confidence::float8 c from insights.platform_theme_sources where workspace_id = $1`, [ws])).rows
  assert.equal(tagged.length, 3)
  assert.ok(tagged.every((t: any) => t.m === 'auto'))
  assert.equal(((await pg.query<any>(`select count(*)::int n, sum(cost_usd)::float8 s from core.ai_usage where purpose = 'theme_match'`)).rows[0]).n, 1, 'the call is on the ledger')

  // Run again: only the themes still without a platform theme are sent, and a title that now exists is attached, not made twice.
  seen.length = 0
  const again = makeAi({}, modelProvider((input) => [{ themeId: input.themes[0].id, newTitle: 'a brand new problem the seed never had', newCategory: 'need', confidence: 0.9 }], seen))
  const second = await refreshPlatformMatches(db, again, ws)
  assert.deepEqual(second, { matched: 1, created: 0 })
  assert.equal(seen[0].themes.length, themes.length - 3)
  assert.ok(seen[0].platform.some((p) => p.title === 'A brand new problem the seed never had'), 'the model is shown the theme it made last time')
})

test('a hand-made tag is never replaced, and a flagged theme with no research behind it goes away; a reviewed one stays', async () => {
  const { pg, db, ws, themes } = await untagged()
  const existing = ((await pg.query<any>(`select id from insights.platform_themes where workspace_id = $1 order by position limit 1`, [ws])).rows[0]).id as string
  const other = ((await pg.query<any>(`select id from insights.platform_themes where workspace_id = $1 order by position offset 1 limit 1`, [ws])).rows[0]).id as string
  await pg.query(`insert into insights.platform_theme_sources (platform_theme_id, theme_id, workspace_id, match_method) values ($1, $2, $3, 'manual')`, [other, themes[0].id, ws])
  const seen: MatchInput[] = []
  const ai = makeAi({}, modelProvider((input) => [{ themeId: themes[0].id, platformThemeId: existing, confidence: 0.95 }, { themeId: input.themes[1].id, newTitle: 'Flagged and soon orphaned', newCategory: 'need', confidence: 0.9 }], seen))
  await refreshPlatformMatches(db, ai, ws)
  assert.ok(!seen[0].themes.some((t) => t.id === themes[0].id), 'a tagged theme is not sent')
  assert.equal(((await pg.query<any>(`select platform_theme_id from insights.platform_theme_sources where theme_id = $1`, [themes[0].id])).rows[0]).platform_theme_id, other, 'the manual tag stands even if the model names another')
  const flagged = ((await pg.query<any>(`select id from insights.platform_themes where title = 'Flagged and soon orphaned'`)).rows[0]).id as string
  // The research behind the flagged theme disappears: with nothing to place, the next refresh removes it.
  await pg.query(`delete from insights.platform_theme_sources where platform_theme_id = $1`, [flagged])
  await refreshPlatformMatches(db, makeAi({}, modelProvider(() => [])), ws)
  assert.equal(((await pg.query<any>(`select count(*)::int n from insights.platform_themes where id = $1`, [flagged])).rows[0]).n, 0)
  // A reviewed theme stays even when empty.
  const kept = ((await pg.query<any>(`insert into insights.platform_themes (workspace_id, title, category, needs_review) values ($1, 'Reviewed and kept', 'need', false) returning id`, [ws])).rows[0]).id as string
  await refreshPlatformMatches(db, makeAi({}, modelProvider(() => [])), ws)
  assert.equal(((await pg.query<any>(`select count(*)::int n from insights.platform_themes where id = $1`, [kept])).rows[0]).n, 1)
})

test('at the budget the keyword matcher stands in: it places by keywords and starts no new platform theme', async () => {
  const { pg, db, ws } = await untagged()
  await pg.query(`insert into core.ai_usage (workspace_id, purpose, provider, cost_usd) values ($1, 'analysis', 'fake-model', 11)`, [ws])
  const seen: MatchInput[] = []
  const ai = makeAi({ AI_MONTHLY_BUDGET_USD: '10' }, modelProvider(() => [{ themeId: 'x', newTitle: 'Never made', newCategory: 'need', confidence: 1 }], seen))
  const r = await refreshPlatformMatches(db, ai, ws)
  assert.equal(seen.length, 0, 'the model was not called')
  assert.ok((r.matched ?? 0) > 0, 'keywords still place the themes they know')
  assert.equal(r.created, 0)
  assert.equal(((await pg.query<any>(`select count(*)::int n from insights.platform_themes where needs_review`)).rows[0]).n, 0)
  assert.equal(((await pg.query<any>(`select count(*)::int n from core.ai_problems where code = 'ai_budget_reached' and purpose = 'theme_match'`)).rows[0]).n, 1, 'the owner can see why')
})
