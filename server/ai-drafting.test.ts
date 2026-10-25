// Slice E3: the model-backed requirements drafter, tested with no model. Unit tests for each guard, then drafting, approving and
// redoing through the real spec code with a fake provider.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { simulatedProvider, type Ai, type AiProvider, type Usage } from './ai.js'
import { ModelOutputError, type ModelCall } from './ai-analysis.js'
import { buildDraftPrompt, draftWithModel, parseDraft, type DraftInput } from './ai-drafting.js'
import { recentAiProblems } from './ai.js'
import { approveStep, createProjectSpec, deleteSpec, getSpec, redoStep } from './specs.js'
import { createDemoDatabase } from './test-utils.js'

const USAGE: Usage = { inputTokens: 800, outputTokens: 300, costUsd: 0.005, model: 'fake-model' }
const replying = (...texts: string[]): ModelCall & { calls: Parameters<ModelCall>[0][] } => {
  const calls: Parameters<ModelCall>[0][] = []
  const fn = (async (req) => {
    calls.push(req)
    return { text: texts[Math.min(calls.length - 1, texts.length - 1)], usage: USAGE }
  }) as ModelCall & { calls: Parameters<ModelCall>[0][] }
  fn.calls = calls
  return fn
}

const INPUT: DraftInput = {
  position: 1,
  prior: [],
  ctx: {
    what: 'Booking flow, contact maya.chen@example.com',
    jtbd: ['I need a visit', 'book online', 'avoid phoning'],
    outcomes: ['Fewer phone calls'],
    people: ['New patient', 'Parent'],
    sessions: 3,
    themes: [
      { id: 'a', title: 'Fees appear too late', cat: 'Pain point', prio: 'High', ppl: 3, total: 3, eff: 1, opp: 'Show fees early', quote: 'Why is the fee only showing up now? Call (555) 010-2222' },
      { id: 'b', title: 'No self-serve rescheduling', cat: 'Pain point', prio: 'Medium', ppl: 2, total: 3, eff: 3, opp: 'Let people change a booking', quote: 'I had to phone to move it.' },
    ],
  },
}
const good = JSON.stringify({ reasoning: 'Participants hit hidden fees at the last step, which is the most widespread barrier in the research.', text: 'Patients cannot see fees early. 3 of 3 participants raised it.', evidence: ['T1'], alternatives: [{ title: 'Frame as visual design', reason: 'Quotes describe missing information.' }] })

test('the prompt masks contact details, numbers the themes, and carries earlier steps and the redo request', () => {
  const p = buildDraftPrompt({ ...INPUT, position: 2, prior: [{ title: 'Frame the problem', lines: ['Mail a@b.co about it.'] }], redoNote: 'Mention parents, call 555-010-9999' })
  assert.ok(!/@|\(\d{3}\)|555/.test(p.user), 'no email or phone in the prompt')
  assert.match(p.user, /T1: "Fees appear too late"/)
  assert.match(p.user, /T2: /)
  assert.match(p.user, /Frame the problem: Mail \[email\] about it\./)
  assert.match(p.user, /reviewer asked for a revision: Mention parents/)
  assert.equal(buildDraftPrompt(INPUT).user, buildDraftPrompt(INPUT).user, 'the same input makes the same prompt')
})

test('a good reply becomes one step in the simulation\'s shape, with evidence named by theme', () => {
  const r = parseDraft(good, INPUT)
  assert.ok(r.ok)
  if (r.ok) {
    assert.equal(r.draft.t, 'Frame the problem')
    assert.deepEqual(r.draft.out, ['Problem', 'Patients cannot see fees early. 3 of 3 participants raised it.'])
    assert.deepEqual(r.draft.ev, ['Fees appear too late · 3/3'])
    assert.equal(r.draft.alts.length, 1)
  }
  const items = parseDraft(JSON.stringify({ reasoning: 'Goals follow from the stated outcomes and the top pain point.', items: ['Cut phone calls by half', 'No fee surprises in round 2'] }), { ...INPUT, position: 3 })
  assert.ok(items.ok && Array.isArray(items.draft.out[1]))
})

test('a reply is refused for: no JSON, missing content, unknown evidence, an invented figure, a wrong session count', () => {
  const bad = (reply: object | string, input = INPUT) => {
    const r = parseDraft(typeof reply === 'string' ? reply : JSON.stringify(reply), input)
    assert.ok(!r.ok)
    return r.ok ? '' : r.problems.join(' | ')
  }
  const base = { reasoning: 'Participants hit hidden fees at the last step, the most widespread barrier.', text: 'Fees show late.' }
  assert.match(bad('sorry, no'), /no JSON/)
  assert.match(bad({ reasoning: base.reasoning }), /"text" is required/)
  assert.match(bad({ reasoning: base.reasoning, text: 'Only text here.' }, { ...INPUT, position: 3 }), /"items" is required/)
  assert.match(bad({ ...base, evidence: ['T9'] }), /T9 is not one of the themes/)
  assert.match(bad({ ...base, text: 'Fees show late for 5 of 7 participants.' }), /"5 of 7" is not a figure/)
  assert.match(bad({ ...base, text: 'Across 9 sessions, fees show late.' }), /does not match the 3 sessions/)
  assert.match(bad({ ...base, reasoning: 'short' }), /reasoning/)
})

test('an unusable reply is retried once with what was wrong, and spend of both calls is added up; a second failure carries the spend', async () => {
  const call = replying('nonsense', good)
  const r = await draftWithModel(call, INPUT)
  assert.equal(r.attempts, 2)
  assert.equal(r.usage.inputTokens, 1600)
  assert.match(call.calls[1].user, /previous reply could not be used/)
  await assert.rejects(draftWithModel(replying('nonsense'), INPUT), (e: any) => e instanceof ModelOutputError && e.usage?.inputTokens === 1600)
})

// Through the real spec code ---------------------------------------------------------------------------------------------

async function setup() {
  const { db, pglite } = await createDemoDatabase()
  const pid = (await db.query(`select id from core.projects where name = 'Clinic booking, round 2'`)).rows[0].id as string
  const actor = (await db.query(`select u.id as "userId", w.id as "workspaceId" from core.users u join core.memberships m on m.user_id = u.id join core.workspaces w on w.id = m.workspace_id where u.email = 'david@demo.signalflow.example'`)).rows[0] as { userId: string; workspaceId: string }
  return { db, pglite, pid, actor }
}

// A live-looking provider whose drafter answers every step with a valid reply that cites the first theme and mentions the redo request.
function drafter(opts: { fail?: boolean; cost?: number } = {}): AiProvider & { requests: { position: number; redoNote?: string; prior: number }[] } {
  const requests: { position: number; redoNote?: string; prior: number }[] = []
  return {
    ...simulatedProvider,
    name: 'fake-live',
    live: true,
    requests,
    draftStep: async (input) => {
      requests.push({ position: input.position, redoNote: input.redoNote, prior: input.prior.length })
      if (opts.fail) throw new Error('boom')
      const step = input.position
      const reply = { reasoning: `Step ${step} follows from the research themes and what the team described.${input.redoNote ? ' Revised: ' + input.redoNote : ''}`, evidence: input.ctx.themes.length ? ['T1'] : [], alternatives: [{ title: 'Another way', reason: 'It hides what people said.' }], ...([3, 5, 8].includes(step) ? { items: ['First point here', 'Second point here'] } : { text: `Drafted text for step ${step}.` }) }
      const r = await draftWithModel(replying(JSON.stringify(reply)), input)
      return { value: { ...r.draft, promptVersion: r.promptVersion }, usage: { ...r.usage, costUsd: opts.cost ?? 0.005 } }
    },
  }
}
const aiOf = (provider: AiProvider, env: Record<string, string> = { AI_MONTHLY_BUDGET_USD: '5' }): Ai => ({ provider, env })

test('creating a document drafts step 1 with the model and records the run, evidence and spend', async () => {
  const { db, pglite, pid, actor } = await setup()
  const p = drafter()
  const specId = (await createProjectSpec(db, aiOf(p), actor, pid)).id
  const spec = (await getSpec(db, actor.workspaceId, specId))!
  assert.equal(spec.steps[0].status, 'review')
  assert.match(spec.steps[0].text!, /Step 1 follows/)
  assert.ok(spec.steps[0].evidence.length === 1)
  assert.equal(spec.steps[0].alternatives.length, 1)
  assert.equal(spec.steps[1].status, 'pending')
  assert.deepEqual(p.requests, [{ position: 1, redoNote: undefined, prior: 0 }])
  const run = (await pglite.query<any>(`select provider, prompt_version from core.agent_runs where kind = 'spec'  and project_id = $1 order by started_at desc limit 1`, [pid])).rows[0]
  assert.deepEqual(run, { provider: 'fake-live', prompt_version: 'spec-draft-v1' })
  assert.equal((await pglite.query<any>(`select count(*)::int n from core.ai_usage where purpose = 'spec_step'`)).rows[0].n, 1)
})

test('approving drafts the next step with the earlier ones as context; redo passes the instructions and counts a revision', async () => {
  const { db, pid, actor } = await setup()
  const p = drafter()
  const ai = aiOf(p)
  const specId = (await createProjectSpec(db, ai, actor, pid)).id
  let spec = (await getSpec(db, actor.workspaceId, specId))!
  await approveStep(db, ai, actor, spec.steps[0].id, spec.steps[0].version)
  spec = (await getSpec(db, actor.workspaceId, specId))!
  assert.equal(spec.steps[0].status, 'approved')
  assert.equal(spec.steps[1].status, 'review')
  assert.deepEqual(p.requests.at(-1), { position: 2, redoNote: undefined, prior: 1 }, 'step 2 was drafted knowing step 1')
  await redoStep(db, ai, actor, spec.steps[1].id, spec.steps[1].version, 'Mention parents')
  spec = (await getSpec(db, actor.workspaceId, specId))!
  assert.equal(p.requests.at(-1)?.redoNote, 'Mention parents')
  assert.equal(spec.steps[1].revision, 1)
  assert.equal(spec.steps[1].redoNote, 'Mention parents')
  assert.match(spec.steps[1].text!, /Revised: Mention parents/)
  assert.ok(!/Revised to account for/.test(spec.steps[1].text!), 'the model writes the revision itself')
})

test('a failed draft changes nothing: approve leaves the step in review, and create leaves no document', async () => {
  const { db, pglite, pid, actor } = await setup()
  const good = aiOf(drafter())
  const specId = (await createProjectSpec(db, good, actor, pid)).id
  const spec = (await getSpec(db, actor.workspaceId, specId))!
  const failing = aiOf(drafter({ fail: true }))
  await assert.rejects(approveStep(db, failing, actor, spec.steps[0].id, spec.steps[0].version))
  const after = (await getSpec(db, actor.workspaceId, specId))!
  assert.equal(after.steps[0].status, 'review', 'not approved')
  assert.equal(after.steps[1].status, 'pending')
  assert.equal(after.steps[0].version, spec.steps[0].version)
  const noted = await recentAiProblems(db, actor.workspaceId)
  assert.ok(noted.length >= 1 && noted[0].purpose === 'spec_step' && noted[0].code === 'ai_unexpected', 'the failure is on record for the owner')
  await approveStep(db, good, actor, spec.steps[0].id, spec.steps[0].version) // and it can be approved again
  const other = (await db.query(`select id from core.projects where name = 'Clinic booking, usability round 1'`)).rows[0].id as string
  for (const row of (await db.query(`select id from delivery.specs where project_id = $1`, [other])).rows) await deleteSpec(db, actor, row.id as string)
  const before = (await pglite.query<any>(`select count(*)::int n from delivery.specs`)).rows[0].n
  await assert.rejects(createProjectSpec(db, failing, actor, other))
  assert.equal((await pglite.query<any>(`select count(*)::int n from delivery.specs`)).rows[0].n, before, 'no half-made document')
})

test('at the budget ceiling the step is drafted by the simulation and the run says so', async () => {
  const { db, pglite, pid, actor } = await setup()
  const ai = aiOf(drafter({ cost: 6 }), { AI_MONTHLY_BUDGET_USD: '5' })
  const specId = (await createProjectSpec(db, ai, actor, pid)).id // costs 6: now over the 5 budget
  let spec = (await getSpec(db, actor.workspaceId, specId))!
  await approveStep(db, ai, actor, spec.steps[0].id, spec.steps[0].version)
  spec = (await getSpec(db, actor.workspaceId, specId))!
  assert.equal(spec.steps[1].status, 'review', 'the simulation drafted step 2')
  assert.ok(!/Step 2 follows/.test(spec.steps[1].text!))
  const run = (await pglite.query<any>(`select provider, prompt_version from core.agent_runs where id = (select agent_run_id from delivery.specs where id = $1)`, [specId])).rows[0]
  assert.deepEqual(run, { provider: 'stub', prompt_version: 'spec-steps-v1' })
})

test('a wordy reply is cut to the limits instead of refused, so it does not cost a second model call', () => {
  const long = 'x'.repeat(2_000)
  const r = parseDraft(JSON.stringify({ reasoning: long, text: long, evidence: [], alternatives: [] }), INPUT)
  assert.ok(r.ok)
  if (r.ok) assert.deepEqual([r.draft.r.length, (r.draft.out[1] as string).length], [1_200, 1_500])
  const items = parseDraft(JSON.stringify({ reasoning: 'Goals follow from the stated outcomes and the top pain point.', items: Array(14).fill(long) }), { ...INPUT, position: 3 })
  assert.ok(items.ok && Array.isArray(items.draft.out[1]) && items.draft.out[1].length === 10 && items.draft.out[1][0].length === 300)
})
