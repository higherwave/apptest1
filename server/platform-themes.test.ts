// Keeping Platform Themes clean: rename, merge, suggested merges, match reasons, and the rank rationale. No model is called.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createApp } from './app.js'
import { makeAi, simulatedProvider, type AiProvider } from './ai.js'
import { ModelOutputError, type ModelCall } from './ai-analysis.js'
import { dedupeWithModel, parseGroups, similarThemes, type DedupeInput } from './ai-dedupe.js'
import { parseRationales, rationalesWithModel, templateRationale, type RationaleInput } from './ai-rationale.js'
import { matchWithModel, buildMatchPrompt } from './ai-matching.js'
import { priorityScore, refreshPlatformMatches } from './insights.js'
import { createDemoDatabase } from './test-utils.js'
// @ts-expect-error plain ESM seed
import { uid } from '../db/seed/seed.mjs'

declare global {
  interface Response {
    json(): Promise<any>
  }
}

const TOKEN = 's3cret'
const auth = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }
const replying = (...texts: string[]): ModelCall & { calls: Parameters<ModelCall>[0][] } => {
  const calls: Parameters<ModelCall>[0][] = []
  const fn = (async (req) => {
    calls.push(req)
    return { text: texts[Math.min(calls.length - 1, texts.length - 1)], usage: { inputTokens: 400, outputTokens: 100, costUsd: 0.0001, model: 'fake-haiku' } }
  }) as ModelCall & { calls: Parameters<ModelCall>[0][] }
  fn.calls = calls
  return fn
}

async function fixture(provider?: AiProvider, env: Record<string, string> = {}) {
  const { pglite: pg, db } = await createDemoDatabase({ anchor: true })
  const app = createApp({ env: { DEV_TOKEN: TOKEN, ...env }, getDb: () => db, provider })
  const ws = uid('workspace') as string
  const api = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = auth) => app.request('/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const overview = async () => (await api('/insights/themes')).json()
  return { pg, db, app, ws, api, overview }
}

// Ranking -----------------------------------------------------------------------------------------------------------------------

test('the priority score weighs reach (people and projects) by what became of the theme', () => {
  const t = { participantCount: 6, projectCount: 2, status: 'not_addressed' as const, opportunity: false }
  assert.equal(priorityScore(t, 12, 4), 50) // 0.6 * 0.5 + 0.4 * 0.5 = 0.5
  assert.ok(priorityScore({ ...t, opportunity: true }, 12, 4) > 50, 'an opportunity ranks higher')
  assert.ok(priorityScore({ ...t, status: 'worked' }, 12, 4) < priorityScore({ ...t, status: 'in_progress' }, 12, 4))
  assert.ok(priorityScore({ ...t, status: 'needs_attention' }, 12, 4) > priorityScore(t, 12, 4))
  assert.equal(priorityScore(t, 0, 0), 0)
})

test('the overview ranks problems and needs from 1, leaves delights unranked, and carries matches and aliases', async () => {
  const { overview } = await fixture()
  const o = await overview()
  const ranked = o.themes.filter((t: any) => t.priority).sort((a: any, b: any) => a.priority.rank - b.priority.rank)
  assert.deepEqual(ranked.map((t: any) => t.priority.rank), ranked.map((_: any, i: number) => i + 1))
  assert.ok(ranked.every((t: any, i: number) => i === 0 || ranked[i - 1].priority.score >= t.priority.score), 'scores never rise down the ranking')
  assert.ok(o.themes.filter((t: any) => t.category === 'delight').every((t: any) => t.priority === null))
  assert.ok(o.themes.every((t: any) => Array.isArray(t.matches) && Array.isArray(t.aliases) && t.rationale === null))
  assert.ok(o.themes.some((t: any) => t.matches.length > 0))
  assert.deepEqual(o.mergeSuggestions, [])
})

// Rename and merge ---------------------------------------------------------------------------------------------------------------

test('renaming keeps the old name as an alias, clears the review flag, refuses a clash, and renaming back drops the alias', async () => {
  const { api, pg, overview } = await fixture()
  const [a, b] = (await overview()).themes
  await pg.query(`update insights.platform_themes set needs_review = true where id = $1`, [a.id])
  const res = await api(`/insights/themes/${a.id}`, 'PATCH', { title: '  A clearer   name for this theme ' })
  assert.equal(res.status, 200)
  assert.equal((await res.json()).title, 'A clearer name for this theme')
  let now = (await overview()).themes.find((t: any) => t.id === a.id)
  assert.equal(now.title, 'A clearer name for this theme')
  assert.deepEqual(now.aliases, [a.title])
  assert.equal(now.needsReview, false)
  const clash = await api(`/insights/themes/${a.id}`, 'PATCH', { title: b.title.toUpperCase() })
  assert.equal(clash.status, 409)
  assert.equal((await clash.json()).error.code, 'duplicate_title')
  assert.equal((await api(`/insights/themes/${a.id}`, 'PATCH', { title: 'ab' })).status, 422)
  assert.equal((await api(`/insights/themes/${a.id}`, 'PATCH', { title: a.title })).status, 200)
  now = (await overview()).themes.find((t: any) => t.id === a.id)
  assert.deepEqual(now.aliases, ['A clearer name for this theme'], 'the middle name is kept as an alias; the restored title is not')
  assert.equal((await api(`/insights/themes/${a.id}`, 'PATCH', { title: 'Nope nope' }, { 'content-type': 'application/json' })).status, 401, 'a visitor cannot rename')
  assert.equal((await api('/insights/themes/not-a-uuid', 'PATCH', { title: 'Something fine' })).status, 404)
})

test('merging moves tags, recommendations and case studies across, keeps the old name, and deletes the merged theme', async () => {
  const { api, pg, ws, overview } = await fixture()
  const before = await overview()
  const [from, into] = before.themes.filter((t: any) => t.participantCount > 0)
  const count = async (sql: string, ...p: unknown[]) => ((await pg.query<any>(sql, p)).rows[0]).n as number
  const sourcesFrom = await count(`select count(*)::int n from insights.platform_theme_sources where platform_theme_id = $1`, from.id)
  const sourcesInto = await count(`select count(*)::int n from insights.platform_theme_sources where platform_theme_id = $1`, into.id)
  await pg.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) values ($1, $2, 'An even older name')`, [from.id, ws])
  const recsBoth = await count(`select count(*)::int n from (select recommendation_id from insights.recommendation_themes where platform_theme_id in ($1, $2) group by recommendation_id) x`, from.id, into.id)
  const res = await api(`/insights/themes/${from.id}/merge`, 'POST', { intoId: into.id })
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { id: into.id, title: into.title })
  assert.equal(await count(`select count(*)::int n from insights.platform_themes where id = $1`, from.id), 0)
  assert.equal(await count(`select count(*)::int n from insights.platform_theme_sources where platform_theme_id = $1`, into.id), sourcesFrom + sourcesInto, 'every tag moved')
  assert.equal(await count(`select count(*)::int n from insights.recommendation_themes where platform_theme_id = $1`, into.id), recsBoth, 'recommendations moved without doubling')
  const after = (await overview()).themes.find((t: any) => t.id === into.id)
  assert.deepEqual([...after.aliases].sort(), [from.title, 'An even older name'].sort())
  assert.equal((await overview()).themes.length, before.themes.length - 1)
  assert.equal((await api(`/insights/themes/${into.id}/merge`, 'POST', { intoId: into.id })).status, 422, 'a theme cannot merge into itself')
  assert.equal((await api(`/insights/themes/${from.id}/merge`, 'POST', { intoId: into.id })).status, 404, 'the merged theme is gone')
  assert.equal((await api(`/insights/themes/${into.id}/merge`, 'POST', { intoId: 'nope' })).status, 422)
  const log = await count(`select count(*)::int n from core.audit_log where entity = 'insights.platform_themes' and verb = 'merged'`)
  assert.equal(log, 1, 'the merge is in the audit log')
})

test('an old name still counts: the matcher shows it to the model and a new title equal to it attaches to the theme', async () => {
  const { pg, db, ws, overview } = await fixture()
  const target = (await overview()).themes[0]
  await pg.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) values ($1, $2, 'An old name for it')`, [target.id, ws])
  await pg.query(`delete from insights.platform_theme_sources where workspace_id = $1`, [ws])
  const seen: any[] = []
  const provider: AiProvider = {
    ...simulatedProvider, name: 'fake-model', live: true,
    matchPlatform: async (input) => {
      seen.push(input)
      return { value: { placements: [{ themeId: input.themes[0].id, newTitle: 'an old name for it!', newCategory: 'need', confidence: 0.9, reason: 'Same as the old name' }], promptVersion: 't' }, usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 } }
    },
  }
  const r = await refreshPlatformMatches(db, makeAi({}, provider), ws)
  assert.deepEqual(r, { matched: 1, created: 0 })
  assert.deepEqual(seen[0].platform.find((p: any) => p.id === target.id).aliases, ['An old name for it'])
  const row = (await pg.query<any>(`select platform_theme_id, reason from insights.platform_theme_sources where theme_id = $1`, [seen[0].themes[0].id])).rows[0]
  assert.equal(row.platform_theme_id, target.id)
  assert.equal(row.reason, 'Same as the old name', 'the model\'s reason is kept')
  const shown = (await overview()).themes.find((t: any) => t.id === target.id)
  assert.ok(shown.matches.some((m: any) => m.reason === 'Same as the old name' && m.method === 'auto'))
  assert.match(buildMatchPrompt({ themes: seen[0].themes, platform: seen[0].platform }).user, /also called: "An old name for it"/)
})

test('the matcher prompt asks for a reason, and a reason is trimmed and kept on the placement', async () => {
  const call = replying(JSON.stringify({ placements: [{ theme: 'N1', decision: 'match', platform: 'P1', confidence: 0.9, reason: '  Both are   about fees  ' }] }))
  const r = await matchWithModel(call, { platform: [{ id: 'p', title: 'Fees', category: 'pain_point' }], themes: [{ id: 't', title: 'Costs', description: '', opportunity: '', category: 'pain_point' }] })
  assert.equal(r.placements[0].reason, 'Both are about fees')
  assert.match(call.calls[0].system, /"reason"/)
})

// Suggested merges --------------------------------------------------------------------------------------------------------------

const DEDUPE: DedupeInput = {
  themes: [
    { id: 'a', title: 'Fees appear late at checkout', category: 'pain_point', participants: 9, projects: 2 },
    { id: 'b', title: 'Surprise costs at payment', category: 'pain_point', participants: 3, projects: 1 },
    { id: 'c', title: 'Provider availability is hard to see', category: 'pain_point', participants: 7, projects: 2 },
    { id: 'd', title: 'Fees appear late in checkout', category: 'pain_point', participants: 2, projects: 1 },
  ],
}
const groupsReply = (groups: unknown[]) => JSON.stringify({ groups })

test('merge groups: references are checked, a theme is in one group, low confidence is dropped, and a bad reply is retried once', async () => {
  const ok = parseGroups(groupsReply([{ keep: 'P1', merge: ['P2'], confidence: 0.9, reason: 'Both are about costs showing late' }, { keep: 'P3', merge: ['P4'], confidence: 0.3, reason: 'weak' }]), DEDUPE)
  assert.ok(ok.ok)
  assert.deepEqual((ok as any).groups, [{ keepId: 'a', mergeIds: ['b'], reason: 'Both are about costs showing late', confidence: 0.9 }])
  assert.ok(!parseGroups(groupsReply([{ keep: 'P1', merge: ['P9'] }]), DEDUPE).ok)
  assert.ok(!parseGroups(groupsReply([{ keep: 'P1', merge: ['P1'] }]), DEDUPE).ok)
  assert.ok(!parseGroups(groupsReply([{ keep: 'P1', merge: ['P2'] }, { keep: 'P3', merge: ['P2'] }]), DEDUPE).ok, 'P2 may not be in two groups')
  assert.deepEqual((parseGroups(groupsReply([]), DEDUPE) as any).groups, [])
  const call = replying(groupsReply([{ keep: 'P1', merge: ['P9'] }]), groupsReply([{ keep: 'P1', merge: ['P4'], confidence: 0.8, reason: 'Same wording' }]))
  const r = await dedupeWithModel(call, DEDUPE)
  assert.equal(r.attempts, 2)
  assert.match(call.calls[1].user, /could not be used/)
  await assert.rejects(() => dedupeWithModel(replying('nonsense'), DEDUPE), ModelOutputError)
})

test('the free check pairs themes that share most of their words, keeping the one more people raised', () => {
  const g = similarThemes(DEDUPE)
  assert.deepEqual(g.map((x) => [x.keepId, x.mergeIds]), [['a', ['d']]])
  assert.deepEqual(similarThemes({ themes: [DEDUPE.themes[0], DEDUPE.themes[2]] }), [])
  const aliased = similarThemes({ themes: [{ ...DEDUPE.themes[1], aliases: ['Provider availability is hard to see'] }, DEDUPE.themes[2]] })
  assert.equal(aliased.length, 1, 'one theme\'s old name is the other\'s title')
})

test('suggestions are filed, shown, accepted (merging) or dismissed (never suggested again); a run adds nothing twice', async () => {
  let asked = 0
  const provider: AiProvider = {
    ...simulatedProvider, name: 'fake-model', live: true,
    suggestMerges: async (input) => {
      asked++
      const [x, y] = input.themes
      return { value: { groups: [{ keepId: x.id, mergeIds: [y.id], reason: 'They say the same thing', confidence: 0.85 }], promptVersion: 't' }, usage: { inputTokens: 100, outputTokens: 30, costUsd: 0.0002, model: 'fake-haiku' } }
    },
  }
  const { api, pg, overview } = await fixture(provider)
  const run = await api('/insights/merge-suggestions/run', 'POST')
  assert.equal(run.status, 200)
  assert.deepEqual(await run.json(), { added: 1 })
  assert.deepEqual(await (await api('/insights/merge-suggestions/run', 'POST')).json(), { added: 0 }, 'the same pair is not filed twice')
  assert.equal(asked, 2)
  const o = await overview()
  assert.equal(o.mergeSuggestions.length, 1)
  const s = o.mergeSuggestions[0]
  assert.equal(s.reason, 'They say the same thing')
  assert.equal(s.confidence, 0.85)
  assert.ok(s.keep.title && s.merge.title && s.keep.id !== s.merge.id)
  assert.equal(((await pg.query<any>(`select count(*)::int n from core.ai_usage where purpose = 'theme_match'`)).rows[0]).n, 2, 'both model calls are on the ledger')
  assert.equal((await api(`/insights/merge-suggestions/${s.id}/dismiss`, 'POST')).status, 204)
  assert.equal((await overview()).mergeSuggestions.length, 0)
  assert.deepEqual(await (await api('/insights/merge-suggestions/run', 'POST')).json(), { added: 0 }, 'a dismissed pair stays dismissed')
  assert.equal((await api(`/insights/merge-suggestions/${s.id}/dismiss`, 'POST')).status, 404)
  // Accepting merges. Clear the dismissal and file a fresh pair by hand.
  const [x, y] = o.themes
  await pg.query(`delete from insights.merge_suggestions`)
  const id = ((await pg.query<any>(`insert into insights.merge_suggestions (workspace_id, keep_id, merge_id, confidence) select workspace_id, id, $2, 0.9 from insights.platform_themes where id = $1 returning id`, [x.id, y.id])).rows[0]).id
  const acc = await api(`/insights/merge-suggestions/${id}/accept`, 'POST')
  assert.equal(acc.status, 200)
  assert.equal((await acc.json()).id, x.id)
  assert.equal((await overview()).themes.some((t: any) => t.id === y.id), false)
  assert.equal((await api(`/insights/merge-suggestions/${id}/accept`, 'POST')).status, 404)
  assert.equal((await api('/insights/merge-suggestions/run', 'POST', undefined, { 'content-type': 'application/json' })).status, 401)
})

test('without a model the free check files suggestions; at the budget it does too and says so', async () => {
  const { api, pg, ws, overview } = await fixture()
  const [a] = (await overview()).themes
  await pg.query(`insert into insights.platform_themes (workspace_id, title, category) values ($1, $2, 'pain_point')`, [ws, a.title.replace('at', 'in')])
  const res = await (await api('/insights/merge-suggestions/run', 'POST')).json()
  assert.equal(res.added, 1, 'the near-identical title is found by words alone')
  assert.equal(((await pg.query<any>(`select count(*)::int n from core.ai_usage`)).rows[0]).n, 0, 'nothing was spent')
  assert.equal((await overview()).mergeSuggestions.length, 1)

  const costly: AiProvider = { ...simulatedProvider, name: 'fake-model', live: true, suggestMerges: async () => { throw new Error('should not be called') } }
  const over = await fixture(costly, { AI_MONTHLY_BUDGET_USD: '1' })
  await over.pg.query(`insert into core.ai_usage (workspace_id, purpose, provider, cost_usd) values ($1, 'analysis', 'fake', 5)`, [over.ws])
  await over.pg.query(`insert into insights.platform_themes (workspace_id, title, category) values ($1, $2, 'pain_point')`, [over.ws, a.title.replace('at', 'in')])
  const r = await (await over.api('/insights/merge-suggestions/run', 'POST')).json()
  assert.deepEqual(r, { added: 1, fallback: 'budget' })
})

// Rationale -----------------------------------------------------------------------------------------------------------------------

const RANKED: RationaleInput = {
  themes: [
    { id: 'a', title: 'Fees appear late at checkout', rank: 1, participants: 9, totalParticipants: 13, projects: 2, totalProjects: 4, status: 'not_addressed', trend: 'growing', opportunity: true, summary: null, requirements: [] },
    { id: 'b', title: 'Provider availability is hard to see', rank: 2, participants: 7, totalParticipants: 13, projects: 1, totalProjects: 4, status: 'in_progress', trend: null, opportunity: false, summary: null, requirements: ['Show open slots'] },
  ],
}
const rationaleReply = (...r: [string, string][]) => JSON.stringify({ rationales: r.map(([theme, text]) => ({ theme, text })) })

test('a rationale may use only the figures it was given, and every theme reference must exist', () => {
  const ok = parseRationales(rationaleReply(['T1', 'Raised by 9 of 13 participants across 2 of 4 projects and growing, with nothing addressing it yet.']), RANKED)
  assert.ok(ok.ok)
  const wrong = parseRationales(rationaleReply(['T1', 'Raised by 10 of 13 participants across 2 of 4 projects, so it ranks first.']), RANKED)
  assert.ok(!wrong.ok)
  assert.match((wrong as any).problems[0], /10 of 13/)
  assert.ok(!parseRationales(rationaleReply(['T1', 'Raised by 9 of 13 participants across 3 of 4 projects, so it ranks first.']), RANKED).ok)
  assert.ok(!parseRationales(rationaleReply(['T7', 'This theme does not exist in the list at all.']), RANKED).ok)
  assert.equal(templateRationale(RANKED.themes[0]), 'Raised by 9 of 13 participants across 2 of 4 projects and it is growing; no requirement addresses it yet.')
})

test('a wrong figure is retried once with the problem quoted', async () => {
  const call = replying(rationaleReply(['T1', 'Raised by 12 of 13 participants, the widest reach of all.']), rationaleReply(['T1', 'Raised by 9 of 13 participants, the widest reach of all.']))
  const r = await rationalesWithModel(call, RANKED)
  assert.equal(r.attempts, 2)
  assert.match(call.calls[1].user, /12 of 13/)
})

test('writing the rationale saves the model\'s text on the top-ranked themes, or a plain template without a model', async () => {
  const withModel: AiProvider = {
    ...simulatedProvider, name: 'fake-model', live: true,
    writeRationales: async (input) => ({ value: { rationales: input.themes.map((t) => ({ themeId: t.id, text: `Ranks #${t.rank} because ${t.participants} of ${t.totalParticipants} participants raised it.` })), promptVersion: 't' }, usage: { inputTokens: 300, outputTokens: 200, costUsd: 0.0003, model: 'fake-haiku' } }),
  }
  const m = await fixture(withModel)
  const res = await (await m.api('/insights/roadmap/rationale', 'POST')).json()
  assert.ok(res.written > 0 && res.written <= 8)
  const top = (await m.overview()).themes.filter((t: any) => t.rationale)
  assert.equal(top.length, res.written)
  assert.ok(top.every((t: any) => t.priority.rank <= 8 && t.rationale.startsWith(`Ranks #${t.priority.rank} because`)))
  assert.equal(((await m.pg.query<any>(`select count(*)::int n from core.ai_usage where purpose = 'theme_match'`)).rows[0]).n, 1)

  const plain = await fixture()
  const r2 = await (await plain.api('/insights/roadmap/rationale', 'POST')).json()
  assert.ok(r2.written > 0)
  const t1 = (await plain.overview()).themes.find((t: any) => t.priority?.rank === 1)
  assert.match(t1.rationale, /^Raised by \d+ of \d+ participants across \d+ of \d+ projects/)
  assert.equal((await plain.api('/insights/roadmap/rationale', 'POST', undefined, { 'content-type': 'application/json' })).status, 401)
})

// Feature areas in matching, automatic merging, and undo -------------------------------------------------------------------------------------

import { applyAreaRule, CROSS_AREA_MIN_CONFIDENCE, type MatchInput } from './ai-matching.js'
import { autoMergeAllowed, autoMergeDuplicates, AUTO_MERGE_OTHER, AUTO_MERGE_SAME_AREA } from './platform-themes.js'

test('area rule: a match across feature areas needs more confidence; no area on either side is never held back', () => {
  const input: MatchInput = {
    themes: [
      { id: 't1', title: 'Fees show up late', description: '', opportunity: '', category: 'pain_point', area: 'Billing' },
      { id: 't2', title: 'Cannot find a slot', description: '', opportunity: '', category: 'pain_point', area: null },
    ],
    platform: [
      { id: 'p1', title: 'Hidden costs at checkout', category: 'pain_point', area: 'Billing' },
      { id: 'p2', title: 'Provider availability is hard to see', category: 'pain_point', area: 'Scheduling' },
      { id: 'p3', title: 'Reminders', category: 'delight', area: null },
    ],
  }
  const placed = (themeId: string, platformThemeId: string, confidence: number) => ({ themeId, platformThemeId, confidence })
  assert.equal(CROSS_AREA_MIN_CONFIDENCE, 0.85)
  const kept = applyAreaRule([placed('t1', 'p1', 0.65), placed('t1', 'p3', 0.65), placed('t2', 'p2', 0.65), placed('t1', 'p2', 0.9)], input, 'start-new')
  assert.deepEqual(kept.map((p) => [p.themeId, p.platformThemeId ?? 'new']), [['t1', 'p1'], ['t1', 'p3'], ['t2', 'p2'], ['t1', 'p2']], 'same area, no area, and a confident cross-area match all stand')
  const held = applyAreaRule([placed('t1', 'p2', 0.8)], input, 'start-new')
  assert.deepEqual(held.map((p) => [p.platformThemeId ?? null, p.newTitle, p.newCategory]), [[null, 'Fees show up late', 'pain_point']], 'a doubtful match across areas starts its own theme')
  assert.deepEqual(applyAreaRule([placed('t1', 'p2', 0.8)], input, 'drop'), [], 'the keyword matcher leaves it unplaced')
  assert.deepEqual(applyAreaRule([{ themeId: 't1', newTitle: 'Something new here', newCategory: 'need', confidence: 0.7 }], input, 'drop').length, 1, 'a new theme is untouched')
})

test('the matcher prompt shows each theme and platform theme with its feature area, and says to prefer the same one', () => {
  const p = buildMatchPrompt({
    themes: [{ id: 't1', title: 'Fees show up late', description: 'd', opportunity: 'o', category: 'pain_point', area: 'Billing' }, { id: 't2', title: 'No area here', description: 'd', opportunity: 'o', category: 'need' }],
    platform: [{ id: 'p1', title: 'Hidden costs', category: 'pain_point', area: 'Billing' }],
  })
  assert.match(p.user, /P1: "Hidden costs" \(pain_point\) \[area: Billing\]/)
  assert.match(p.user, /N1: "Fees show up late" \(pain_point\) \[area: Billing\]/)
  assert.ok(!/N2: .*\[area/.test(p.user))
  assert.match(p.system, /Prefer a platform theme in the same area/)
  assert.match(p.system, /0\.85 or more/)
})

test('automatic merging: same known area needs 0.75, anything else 0.9, and a pain point is never folded into a delight', () => {
  assert.deepEqual([AUTO_MERGE_SAME_AREA, AUTO_MERGE_OTHER], [0.75, 0.9])
  const a = (category = 'pain_point', area: string | null = 'Billing') => ({ category, area })
  assert.equal(autoMergeAllowed(a(), a(), 0.75), true)
  assert.equal(autoMergeAllowed(a(), a(), 0.74), false)
  assert.equal(autoMergeAllowed(a(), a('pain_point', 'billing'), 0.8), true, 'area names compare without regard to case')
  assert.equal(autoMergeAllowed(a(), a('pain_point', 'Scheduling'), 0.89), false)
  assert.equal(autoMergeAllowed(a(), a('pain_point', 'Scheduling'), 0.9), true)
  assert.equal(autoMergeAllowed(a(), a('pain_point', null), 0.8), false, 'one side without an area is not evidence')
  assert.equal(autoMergeAllowed(a('pain_point', null), a('pain_point', null), 0.9), true)
  assert.equal(autoMergeAllowed(a('pain_point'), a('delight'), 0.99), false)
})

test('a merge is recorded and undo puts back the theme, its tags, its links and every name exactly as they were', async () => {
  const { api, pg, overview, ws } = await fixture()
  const themes = (await overview()).themes
  const into = themes.find((t: any) => t.matches.length > 0 && t.requirements)
  const from = themes.find((t: any) => t.id !== into.id && t.matches.length > 0)
  await pg.query(`insert into insights.platform_theme_aliases (platform_theme_id, workspace_id, alias) values ($1, $2, 'An older name of the folded theme')`, [from.id, ws])
  const snapshot = async (id: string) => ({
    sources: (await pg.query<any>(`select theme_id from insights.platform_theme_sources where platform_theme_id = $1 order by theme_id`, [id])).rows.map((r) => r.theme_id),
    recs: (await pg.query<any>(`select recommendation_id from insights.recommendation_themes where platform_theme_id = $1 order by 1`, [id])).rows.map((r) => r.recommendation_id),
    cases: (await pg.query<any>(`select case_study_id from insights.case_study_themes where platform_theme_id = $1 order by 1`, [id])).rows.map((r) => r.case_study_id),
    aliases: (await pg.query<any>(`select alias from insights.platform_theme_aliases where platform_theme_id = $1 order by 1`, [id])).rows.map((r) => r.alias),
  })
  const [beforeFrom, beforeInto] = [await snapshot(from.id), await snapshot(into.id)]
  const row = (await pg.query<any>(`select title, category, position from insights.platform_themes where id = $1`, [from.id])).rows[0]

  assert.equal((await api(`/insights/themes/${from.id}/merge`, 'POST', { intoId: into.id })).status, 200)
  assert.equal((await pg.query<any>(`select count(*)::int n from insights.platform_themes where id = $1`, [from.id])).rows[0].n, 0)
  const listed = await (await api('/insights/merges')).json()
  assert.equal(listed.data.length, 1)
  assert.deepEqual([listed.data[0].keptId, listed.data[0].keptTitle, listed.data[0].mergedTitle, listed.data[0].auto, listed.data[0].undone, listed.data[0].canUndo], [into.id, into.title, from.title, false, false, true])
  assert.equal((await api('/insights/merges')).status, 200)

  assert.equal((await api(`/insights/merges/${listed.data[0].id}/undo`, 'POST', undefined, { 'content-type': 'application/json' })).status, 401, 'a visitor cannot undo')
  const undone = await api(`/insights/merges/${listed.data[0].id}/undo`, 'POST')
  assert.equal(undone.status, 200)
  assert.deepEqual(await undone.json(), { id: from.id, title: from.title })
  assert.deepEqual(await snapshot(from.id), beforeFrom, 'tags, links and names of the theme that came back')
  assert.deepEqual(await snapshot(into.id), beforeInto, 'and the theme it had been folded into is as it was')
  assert.deepEqual((await pg.query<any>(`select title, category, position from insights.platform_themes where id = $1`, [from.id])).rows[0], row)
  assert.equal((await (await api('/insights/merges')).json()).data[0].undone, true)
  assert.equal((await api(`/insights/merges/${listed.data[0].id}/undo`, 'POST')).status, 404, 'a merge is undone once')
  assert.equal((await api('/insights/merges/not-a-uuid/undo', 'POST')).status, 404)

  // It can be merged again, and undone again.
  assert.equal((await api(`/insights/themes/${from.id}/merge`, 'POST', { intoId: into.id })).status, 200)
  assert.equal((await (await api('/insights/merges')).json()).data.filter((m: any) => m.canUndo).length, 1)
})

test('undo is refused when the theme it was folded into is gone, or its old title is now taken; the merge stays on the list', async () => {
  const { api, pg, overview } = await fixture()
  const [a, b, c] = (await overview()).themes
  await api(`/insights/themes/${b.id}/merge`, 'POST', { intoId: a.id })
  const first = (await (await api('/insights/merges')).json()).data[0]
  // Another theme takes the title that b had.
  await pg.query(`update insights.platform_themes set title = $2 where id = $1`, [c.id, b.title])
  const clash = await api(`/insights/merges/${first.id}/undo`, 'POST')
  assert.equal(clash.status, 409)
  assert.equal((await clash.json()).error.code, 'duplicate_title')
  assert.equal((await (await api('/insights/merges')).json()).data[0].canUndo, true, 'still undoable once the clash is cleared')
  // The theme it was folded into is itself merged away: the history goes with it.
  await api(`/insights/themes/${a.id}/merge`, 'POST', { intoId: c.id })
  assert.ok(!(await (await api('/insights/merges')).json()).data.some((m: any) => m.id === first.id && m.canUndo), 'nothing left to undo it into')
})

test('automatic merging folds the clear pairs, records them as automatic, and files the rest as suggestions', async () => {
  const groupsFor = (confidence: number) => (input: DedupeInput) => {
    const [x, y] = input.themes
    return { groups: [{ keepId: x.id, mergeIds: [y.id], reason: 'They say the same thing', confidence }], promptVersion: 't' }
  }
  const run = async (confidence: number, setup: (pg: any, ids: { keep: string; merge: string }) => Promise<void>) => {
    const provider: AiProvider = {
      ...simulatedProvider, name: 'fake-model', live: true,
      suggestMerges: async (input) => ({ value: groupsFor(confidence)(input), usage: { inputTokens: 100, outputTokens: 30, costUsd: 0.0002, model: 'fake-haiku' } }),
    }
    const { pg, db, ws, overview } = await fixture(provider)
    const first = (await overview()).themes
    const ai = makeAi({}, provider)
    const user = (await pg.query<any>(`select id from core.users limit 1`)).rows[0].id as string
    // Which two themes the stand-in model pairs is decided by the order the overview lists them in.
    const ordered = await (async () => { let seen: string[] = []; await ai.provider.suggestMerges!({ themes: (await overview()).themes.map((t: any) => ({ id: t.id, title: t.title, category: t.category, participants: 0, projects: 0 })) }).then((r) => { seen = [r.value.groups[0].keepId, r.value.groups[0].mergeIds[0]] }); return seen })()
    await setup(pg, { keep: ordered[0], merge: ordered[1] })
    const result = await autoMergeDuplicates(db, ai, { workspaceId: ws, userId: user } as any)
    return { result, pg, ordered, count: first.length, history: (await pg.query(`select auto, confidence::float8 c from insights.merge_history`)).rows as any[], left: (await pg.query<any>(`select count(*)::int n from insights.platform_themes`)).rows[0].n as number }
  }
  const area = async (pg: any, themeId: string, name: string) => {
    const a = (await pg.query(`insert into insights.feature_areas (workspace_id, name) select workspace_id, $1 from insights.platform_themes limit 1 on conflict do nothing returning id`, [name])).rows[0]
    const id = a?.id ?? (await pg.query(`select id from insights.feature_areas where name = $1`, [name])).rows[0].id
    await pg.query(`update research.themes set area_id = $2 where id in (select theme_id from insights.platform_theme_sources where platform_theme_id = $1)`, [themeId, id])
  }
  const same = async (pg: any, ids: { keep: string; merge: string }) => { await pg.query(`update insights.platform_themes set category = 'pain_point' where id = any($1::uuid[])`, [[ids.keep, ids.merge]]); await area(pg, ids.keep, 'Booking'); await area(pg, ids.merge, 'Booking') }

  // Same area at 0.8: merged on its own, recorded as automatic, nothing left to suggest.
  const merged = await run(0.8, same)
  assert.deepEqual([merged.result.merged, merged.result.suggested, merged.left], [1, 0, merged.count - 1])
  assert.deepEqual(merged.history, [{ auto: true, c: 0.8 }])
  // The same 0.8 across two different areas is only a suggestion; at 0.95 it is merged.
  const cross = async (pg: any, ids: { keep: string; merge: string }) => { await pg.query(`update insights.platform_themes set category = 'pain_point' where id = any($1::uuid[])`, [[ids.keep, ids.merge]]); await area(pg, ids.keep, 'Booking'); await area(pg, ids.merge, 'Billing') }
  const held = await run(0.8, cross)
  assert.deepEqual([held.result.merged, held.result.suggested, held.left, held.history.length], [0, 1, held.count, 0])
  assert.equal((await run(0.95, cross)).result.merged, 1)
  // A pain point is not folded into a delight, however sure the model is.
  const kinds = await run(0.99, async (pg, ids) => { await pg.query(`update insights.platform_themes set category = 'pain_point' where id = $1`, [ids.keep]); await pg.query(`update insights.platform_themes set category = 'delight' where id = $1`, [ids.merge]) })
  assert.deepEqual([kinds.result.merged, kinds.result.suggested], [0, 1])
})
