import { callAiWithFallback, simulatedProvider, type Ai } from './ai.js'
import type { Db, Queryable } from './db.js'
import { ApiError } from './errors.js'
import { currentAnalysisRun } from './transcripts.js'
import { insertMany } from './sql.js'
import type { Actor } from './versioning.js'

// The eight fixed steps of the requirements writer, in order. They are the same for every project, so every product
// manager follows the same approach; the version is recorded on the run (prompt_version).
export const SPEC_STEPS = [
  { key: 'frame_problem', title: 'Frame the problem' },
  { key: 'users_jobs', title: 'Identify users and jobs' },
  { key: 'goals_metrics', title: 'Define goals and success metrics' },
  { key: 'scope', title: 'Set scope' },
  { key: 'requirements', title: 'Draft requirements' },
  { key: 'risks_dependencies', title: 'Assess risks and dependencies' },
  { key: 'rollout', title: 'Plan the rollout' },
  { key: 'open_questions', title: 'List open questions' },
] as const
export const SPEC_PROMPT_VERSION = 'spec-steps-v1'
const BRIEF_STEPS = 3 // steps 1 to 3 build the product brief; 4 to 8 build the requirements document

export type SpecTheme = { id: string; title: string; category: string; priority: string; effort: number; participantCount: number; totalParticipants: number; included: boolean }
export type SpecStep = {
  id: string
  position: number
  key: string
  title: string
  status: 'pending' | 'review' | 'approved'
  text: string | null
  originalText: string | null
  edited: boolean
  redoNote: string | null
  revision: number
  version: number
  evidence: { themeId: string; title: string; label: string }[]
  alternatives: { title: string; reason: string }[]
  approvedAt: string | null
}
export type SpecDetail = {
  id: string
  projectId: string
  projectName: string
  standalone: boolean
  name: string
  status: 'draft' | 'published'
  publishedAt: string | null
  stale: boolean
  version: number
  sessions: number
  themes: SpecTheme[]
  steps: SpecStep[]
  brief: { problem: string | null; users: string | null; goals: string[] | null; locked: boolean }
  document: { heading: string; lines: string[] }[]
  approved: number
  total: number
  canPublish: boolean
  preview: { requirements: number; openQuestions: number }
}
export type SpecSummary = { id: string; projectId: string; projectName: string; standalone: boolean; name: string; status: 'draft' | 'published'; publishedAt: string | null; stale: boolean; approved: number; total: number; createdAt: string }

export class SpecNotFound extends Error {}
export class SpecPublished extends Error {}
export class NoAnalysis extends Error {}
export class StepOutOfOrder extends Error {}
export class StepConflict extends Error {
  constructor(public current: number) {
    super('step version conflict')
  }
}
export class SpecConflict extends Error {
  constructor(public current: number) {
    super('spec version conflict')
  }
}
export class NotAllApproved extends Error {}

const CATEGORY_LABEL: Record<string, string> = { pain_point: 'Pain point', need: 'Need', expectation: 'Expectation', delight: 'Delight' }
const PRIORITY_LABEL: Record<string, string> = { high: 'High', medium: 'Medium', low: 'Low' }
const rank = (t: { prio: string; ppl: number }) => (t.prio === 'High' ? 3 : t.prio === 'Medium' ? 2 : 1) * 10 + t.ppl

// Reading -----------------------------------------------------------------------------------------------------

async function specRow(db: Queryable, workspaceId: string, specId: string) {
  const r = (
    await db.query(
      `select s.id, s.project_id, s.name, s.agent_run_id, s.status, s.published_at, s.stale, s.version, p.name as project_name, p.kind as project_kind
       from delivery.specs s join core.projects p on p.id = s.project_id
       where s.id = $1 and s.workspace_id = $2`,
      [specId, workspaceId],
    )
  ).rows[0]
  return r as Record<string, any> | undefined
}

// The themes this document is built from, as the drafter sees them: the person's rename, importance and effort
// applied, with participant counts and the first quote.
async function themesForSpec(db: Queryable, specId: string): Promise<{ theme: SpecTheme; opp: string | null; quote: string }[]> {
  const rows = (
    await db.query(
      `select t.id, coalesce(o.title, t.title) as title, t.category, coalesce(o.priority, t.suggested_priority) as priority, coalesce(o.effort, t.suggested_effort) as effort,
              t.opportunity, t.score, st.participant_count::int as ppl, st.total_participants::int as total, sth.included,
              (select u.text from research.theme_quotes tq join research.utterances u on u.id = tq.utterance_id
               join research.transcripts tr on tr.id = u.transcript_id where tq.theme_id = t.id order by tr.position, u.position limit 1) as quote
       from delivery.spec_themes sth
       join research.themes t on t.id = sth.theme_id
       left join research.theme_overrides o on o.theme_id = t.id
       join research.theme_stats st on st.theme_id = t.id
       where sth.spec_id = $1
       order by t.score desc nulls last, t.title`,
      [specId],
    )
  ).rows
  return rows.map((r) => ({
    theme: { id: r.id, title: r.title, category: r.category, priority: r.priority, effort: r.effort, participantCount: r.ppl, totalParticipants: r.total, included: r.included },
    opp: r.opportunity ?? null,
    quote: r.quote ?? '',
  }))
}

type Scoped = { id: string; title: string; opp: string; ppl: number; total: number; prio: string; eff: number; quote: string; cat: string }
function scopeThemes(items: { theme: SpecTheme; opp: string | null; quote: string }[]) {
  const included: Scoped[] = items
    .filter((i) => i.theme.included)
    .map((i) => ({ id: i.theme.id, title: i.theme.title, opp: i.opp ?? `Address: ${i.theme.title}`, ppl: i.theme.participantCount, total: i.theme.totalParticipants, prio: PRIORITY_LABEL[i.theme.priority], eff: i.theme.effort, quote: i.quote, cat: CATEGORY_LABEL[i.theme.category] }))
  return {
    included,
    inScope: included.filter((t) => t.eff <= 2).sort((a, b) => rank(b) - rank(a)), // becomes requirements R1, R2 ...
    outScope: included.filter((t) => t.eff === 3), // becomes open questions
  }
}

async function draftingContext(db: Queryable, spec: Record<string, any>) {
  const items = await themesForSpec(db, spec.id)
  const study = (await db.query(`select what_testing, jtbd_when, jtbd_want, jtbd_so, outcomes from research.studies where project_id = $1`, [spec.project_id])).rows[0]
  // A research project's test items are what it is testing and what it expects to learn; a stand-alone document has only its description.
  const testItems = (await db.query(`select description, outcomes from research.test_items where project_id = $1 order by position`, [spec.project_id])).rows
  const described = testItems.map((i) => i.description as string | null).filter((d): d is string => !!d)
  const people = (await db.query(`select role from research.participants where project_id = $1 and role is not null order by position`, [spec.project_id])).rows.map((r) => r.role as string)
  const sessions = (await db.query(`select count(*)::int n from research.transcripts where project_id = $1`, [spec.project_id])).rows[0].n as number
  const { included } = scopeThemes(items)
  const ctx = {
    // Several items read as one phrase: "Booking flow; reminders".
    what: described.length ? described.map((d, i) => (i === 0 ? d : d.charAt(0).toLowerCase() + d.slice(1))).join('; ') : (study?.what_testing ?? ''),
    jtbd: study?.jtbd_when ? [study.jtbd_when, study.jtbd_want ?? '', study.jtbd_so ?? ''] : null,
    outcomes: testItems.length ? testItems.flatMap((i) => i.outcomes as string[]) : ((study?.outcomes ?? []) as string[]),
    people,
    sessions,
    themes: included.map((t) => ({ id: t.id, title: t.title, cat: t.cat, prio: t.prio, ppl: t.ppl, total: t.total, eff: t.eff, opp: t.opp, quote: t.quote })),
  }
  return { ctx, inc: Object.fromEntries(included.map((t) => [t.id, true])), items }
}

export async function getSpec(db: Queryable, workspaceId: string, specId: string): Promise<SpecDetail | undefined> {
  const spec = await specRow(db, workspaceId, specId)
  if (!spec) return undefined
  const items = await themesForSpec(db, specId)
  const stepRows = (await db.query(`select id, position, key, title, status, reasoning, edited_text, redo_note, revision, version, output, approved_at from core.agent_steps where run_id = $1 order by position`, [spec.agent_run_id])).rows
  const ids = stepRows.map((s) => s.id)
  const evidence = ids.length ? (await db.query(`select e.step_id, e.theme_id, coalesce(o.title, t.title) as title, st.participant_count::int as ppl, st.total_participants::int as total from delivery.spec_step_evidence e join research.themes t on t.id = e.theme_id left join research.theme_overrides o on o.theme_id = t.id join research.theme_stats st on st.theme_id = t.id where e.step_id = any($1::uuid[])`, [ids])).rows : []
  const alts = ids.length ? (await db.query(`select step_id, title, reason from core.agent_step_alternatives where step_id = any($1::uuid[]) order by position`, [ids])).rows : []
  const sessions = (await db.query(`select count(*)::int n from research.transcripts where project_id = $1`, [spec.project_id])).rows[0].n as number

  const steps: SpecStep[] = stepRows.map((s) => ({
    id: s.id,
    position: s.position,
    key: s.key,
    title: s.title,
    status: s.status === 'thinking' ? 'review' : s.status,
    text: s.edited_text ?? s.reasoning ?? null,
    originalText: s.reasoning ?? null,
    edited: s.edited_text !== null && s.edited_text !== undefined,
    redoNote: s.redo_note ?? null,
    revision: s.revision,
    version: s.version,
    evidence: evidence.filter((e) => e.step_id === s.id).map((e) => ({ themeId: e.theme_id, title: e.title, label: `${e.title} · ${e.ppl}/${e.total}` })),
    alternatives: alts.filter((a) => a.step_id === s.id).map((a) => ({ title: a.title, reason: a.reason })),
    approvedAt: s.approved_at ? new Date(s.approved_at).toISOString() : null,
  }))
  const out = (position: number) => stepRows.find((s) => s.position === position && s.status === 'approved')?.output as { heading: string; text: string | null; items: string[] | null } | undefined
  const approved = steps.filter((s) => s.status === 'approved').length
  const briefLocked = steps.slice(0, BRIEF_STEPS).every((s) => s.status === 'approved')
  const scope = scopeThemes(items)

  return {
    id: spec.id,
    projectId: spec.project_id,
    projectName: spec.project_name,
    standalone: spec.project_kind === 'standalone',
    name: spec.name,
    status: spec.status,
    publishedAt: spec.published_at ? new Date(spec.published_at).toISOString() : null,
    stale: spec.stale,
    version: spec.version,
    sessions,
    themes: items.map((i) => i.theme),
    steps,
    brief: {
      problem: out(1)?.text ?? null,
      users: out(2)?.text ?? null,
      goals: out(3)?.items ?? (out(3)?.text ? [out(3)!.text as string] : null),
      locked: briefLocked,
    },
    document: [4, 5, 6, 7, 8].flatMap((p) => {
      const o = out(p)
      return o ? [{ heading: o.heading, lines: o.items ?? (o.text ? [o.text] : []) }] : []
    }),
    approved,
    total: steps.length,
    canPublish: spec.status === 'draft' && steps.length === SPEC_STEPS.length && approved === steps.length,
    preview: { requirements: scope.inScope.length, openQuestions: scope.outScope.length },
  }
}

export async function listSpecs(db: Queryable, workspaceId: string, filter: { projectId?: string; standalone?: boolean }): Promise<SpecSummary[]> {
  const where = ['s.workspace_id = $1']
  const params: unknown[] = [workspaceId]
  if (filter.projectId) { params.push(filter.projectId); where.push(`s.project_id = $${params.length}`) }
  if (filter.standalone) where.push(`p.kind = 'standalone'`)
  const rows = (
    await db.query(
      `select s.id, s.project_id, s.name, s.status, s.published_at, s.stale, s.created_at, p.name as project_name, p.kind,
              (select count(*)::int from core.agent_steps a where a.run_id = s.agent_run_id and a.status = 'approved') as approved,
              (select count(*)::int from core.agent_steps a where a.run_id = s.agent_run_id) as total
       from delivery.specs s join core.projects p on p.id = s.project_id
       where ${where.join(' and ')} order by s.created_at desc, s.name`,
      params,
    )
  ).rows
  return rows.map((r) => ({
    id: r.id, projectId: r.project_id, projectName: r.project_name, standalone: r.kind === 'standalone', name: r.name, status: r.status,
    publishedAt: r.published_at ? new Date(r.published_at).toISOString() : null, stale: r.stale, approved: r.approved, total: r.total, createdAt: new Date(r.created_at).toISOString(),
  }))
}

// Writing -----------------------------------------------------------------------------------------------------

type Drafted = { s: { t: string; r: string; ev: string[]; alts: { title: string; reason: string }[]; out: [string, (string | string[])?, (string[])?] }; items: Awaited<ReturnType<typeof themesForSpec>>; provider: string; promptVersion: string; byModel: boolean }

// The steps already drafted before this one, as plain lines, so a model keeps the document consistent.
async function priorSteps(db: Queryable, runId: string, position: number): Promise<{ title: string; lines: string[] }[]> {
  const rows = (await db.query(`select title, output from core.agent_steps where run_id = $1 and position < $2 and output is not null order by position`, [runId, position])).rows
  return rows.map((r) => {
    const o = r.output as { text: string | null; items: string[] | null }
    return { title: r.title as string, lines: o.items ?? (o.text ? [o.text] : []) }
  })
}

// Gets one step's draft. This is the slow part (a model call), so it is made with the connection pool, never inside a transaction:
// a slow call holds no lock, and its cost stays in the ledger even if saving the step later fails. When the month's budget or the
// account's credit is used up the simulation drafts the step instead.
async function draftStep(db: Queryable, ai: Ai, ctx: Actor, spec: Record<string, any>, position: number, redoNote?: string): Promise<Drafted> {
  const { ctx: draft, inc, items } = await draftingContext(db, spec)
  const prior = await priorSteps(db, spec.agent_run_id, position)
  let byModel = false
  let promptVersion = SPEC_PROMPT_VERSION
  const { value, fallback } = await callAiWithFallback<Drafted['s']>(
    db, ai, ctx.workspaceId, 'spec_step',
    async (p) => {
      if (!p.draftStep) {
        const all = await p.buildSteps(draft, inc)
        return { value: all.value[position - 1] as Drafted['s'], usage: all.usage }
      }
      const r = await p.draftStep({ position, ctx: draft, prior, redoNote })
      byModel = true
      promptVersion = r.value.promptVersion
      return { value: r.value, usage: r.usage }
    },
    spec.agent_run_id,
  )
  const live = byModel && !fallback
  return { s: value, items, provider: live ? ai.provider.name : simulatedProvider.name, promptVersion: live ? promptVersion : SPEC_PROMPT_VERSION, byModel: live }
}

// Writes one step's drafted content: its reasoning, output, evidence and the alternatives it considered.
async function storeStep(tx: Queryable, ctx: Actor, runId: string, stepId: string, drafted: Drafted, redoNote?: string): Promise<void> {
  const { s, items } = drafted
  const [heading, second, third] = s.out
  await tx.query(
    `update core.agent_steps set reasoning = $2, edited_text = null, status = 'review', redo_note = $3, revision = revision + $4, output = $5::jsonb, approved_by = null, approved_at = null, updated_by = $6 where id = $1`,
    [stepId, s.r + (redoNote && !drafted.byModel ? ` Revised to account for: ${redoNote}.` : ''), redoNote ?? null, redoNote ? 1 : 0, JSON.stringify({ heading, text: Array.isArray(second) ? null : (second ?? null) || null, items: Array.isArray(second) ? second : (third ?? null) }), ctx.userId],
  )
  await tx.query(`update core.agent_runs set provider = $2, prompt_version = $3 where id = $1`, [runId, drafted.provider, drafted.promptVersion])
  await tx.query(`delete from delivery.spec_step_evidence where step_id = $1`, [stepId])
  await tx.query(`delete from core.agent_step_alternatives where step_id = $1`, [stepId])
  const evidence = s.ev.flatMap((e) => {
    const title = e.split(' · ')[0]
    const hit = items.find((i) => i.theme.title === title)
    return hit ? [{ step_id: stepId, theme_id: hit.theme.id, workspace_id: ctx.workspaceId }] : []
  })
  await insertMany(tx, 'delivery.spec_step_evidence', evidence)
  await insertMany(tx, 'core.agent_step_alternatives', s.alts.map((a, i) => ({ workspace_id: ctx.workspaceId, step_id: stepId, position: i, title: a.title, reason: a.reason })))
}

async function createSpecRows(tx: Queryable, ctx: Actor, projectId: string, name: string, themeIds: string[]): Promise<string> {
  const runId = crypto.randomUUID()
  const specId = crypto.randomUUID()
  await tx.query(`insert into core.agent_runs (id, workspace_id, project_id, kind, status, provider, prompt_version, created_by, updated_by) values ($1, $2, $3, 'spec', 'running', 'stub', $4, $5, $5)`, [runId, ctx.workspaceId, projectId, SPEC_PROMPT_VERSION, ctx.userId])
  await insertMany(tx, 'delivery.specs', [{ id: specId, workspace_id: ctx.workspaceId, project_id: projectId, name, agent_run_id: runId, status: 'draft', created_by: ctx.userId, updated_by: ctx.userId }])
  const steps = SPEC_STEPS.map((s, i) => ({ id: crypto.randomUUID(), workspace_id: ctx.workspaceId, run_id: runId, position: i + 1, key: s.key, title: s.title, status: 'pending', created_by: ctx.userId, updated_by: ctx.userId }))
  await insertMany(tx, 'core.agent_steps', steps)
  await insertMany(tx, 'delivery.spec_themes', themeIds.map((id) => ({ spec_id: specId, theme_id: id, workspace_id: ctx.workspaceId, included: true })))
  await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'delivery.specs', entity_id: specId, verb: 'created', after: { name } }])
  return specId
}

// Step 1 starts at once; each approval starts the next. It is drafted after the rows are saved and outside any transaction. If it
// cannot be drafted (the model is unavailable) the new document is removed again, so nobody is left with an empty one.
async function startFirstStep(db: Db, ai: Ai, ctx: Actor, specId: string): Promise<string> {
  try {
    const spec = (await specRow(db, ctx.workspaceId, specId))!
    const first = (await db.query(`select id from core.agent_steps where run_id = $1 and position = 1`, [spec.agent_run_id])).rows[0]
    const drafted = await draftStep(db, ai, ctx, spec, 1)
    await db.transaction((tx) => storeStep(tx, ctx, spec.agent_run_id, first.id as string, drafted))
  } catch (err) {
    await deleteSpec(db, ctx, specId).catch(() => undefined)
    throw err
  }
  return specId
}

export async function createProjectSpec(db: Db, ai: Ai, ctx: Actor, projectId: string, name?: string): Promise<string> {
  const specId = await db.transaction(async (tx) => {
    const p = (await tx.query(`select id, name from core.projects where id = $1 and workspace_id = $2 and kind = 'research'`, [projectId, ctx.workspaceId])).rows[0]
    if (!p) throw new SpecNotFound()
    const run = await currentAnalysisRun(tx, projectId)
    const themeIds = run ? (await tx.query(`select id from research.themes where project_id = $1 and run_id = $2`, [projectId, run.id])).rows.map((r) => r.id as string) : []
    if (!themeIds.length) throw new NoAnalysis()
    return createSpecRows(tx, ctx, projectId, name?.trim() || p.name, themeIds)
  })
  return startFirstStep(db, ai, ctx, specId)
}

// A stand-alone document has no research behind it: it is drafted from the description alone, so it lives in a project of
// its own kind and never appears in the research projects list.
export async function createStandaloneSpec(db: Db, ai: Ai, ctx: Actor, input: { name: string; what: string }): Promise<string> {
  const specId = await db.transaction(async (tx) => {
    const projectId = (await tx.query(`insert into core.projects (workspace_id, name, kind, owner_id, created_by, updated_by) values ($1, $2, 'standalone', $3, $3, $3) returning id`, [ctx.workspaceId, input.name, ctx.userId])).rows[0].id as string
    await insertMany(tx, 'research.studies', [{ project_id: projectId, workspace_id: ctx.workspaceId, what_testing: input.what, created_by: ctx.userId, updated_by: ctx.userId }])
    return createSpecRows(tx, ctx, projectId, input.name, [])
  })
  return startFirstStep(db, ai, ctx, specId)
}

// Loads a step with its spec, and refuses an action on a published document or with a stale version.
async function lockStep(tx: Queryable, ctx: Actor, stepId: string, expected: number, lock = true) {
  const r = (
    await tx.query(
      `select a.id, a.position, a.status, a.version, s.id as spec_id from core.agent_steps a
       join delivery.specs s on s.agent_run_id = a.run_id where a.id = $1 and s.workspace_id = $2${lock ? ' for update of a' : ''}`,
      [stepId, ctx.workspaceId],
    )
  ).rows[0]
  if (!r) throw new SpecNotFound()
  const spec = (await specRow(tx, ctx.workspaceId, r.spec_id))!
  if (spec.status === 'published') throw new SpecPublished()
  if (r.version !== expected) throw new StepConflict(r.version)
  return { step: r, spec }
}

// Approving a step starts the next one, in order. The next step is drafted from the themes included at that moment. The draft is made
// first, outside the transaction; the step is then locked, checked again and approved together with saving the draft, so a failed
// draft leaves everything as it was and the step can be approved again.
export async function approveStep(db: Db, ai: Ai, ctx: Actor, stepId: string, expected: number): Promise<string> {
  const peek = await lockStep(db, ctx, stepId, expected, false)
  if (peek.step.status !== 'review') throw new StepOutOfOrder()
  const nextRow = (await db.query(`select id, position, status from core.agent_steps where run_id = $1 and position = $2`, [peek.spec.agent_run_id, peek.step.position + 1])).rows[0]
  const drafted = nextRow && nextRow.status === 'pending' ? await draftStep(db, ai, ctx, peek.spec, nextRow.position) : undefined
  return db.transaction(async (tx) => {
    const { step, spec } = await lockStep(tx, ctx, stepId, expected)
    if (step.status !== 'review') throw new StepOutOfOrder()
    await tx.query(`update core.agent_steps set status = 'approved', approved_by = $2, approved_at = now(), updated_by = $2 where id = $1`, [stepId, ctx.userId])
    const next = (await tx.query(`select id, position, status from core.agent_steps where run_id = $1 and position = $2`, [spec.agent_run_id, step.position + 1])).rows[0]
    if (next && next.status === 'pending' && drafted) await storeStep(tx, ctx, spec.agent_run_id, next.id, drafted)
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.agent_steps', entity_id: stepId, verb: 'approved' }])
    return spec.id as string
  })
}

export async function redoStep(db: Db, ai: Ai, ctx: Actor, stepId: string, expected: number, instructions: string): Promise<string> {
  const peek = await lockStep(db, ctx, stepId, expected, false)
  if (peek.step.status === 'pending') throw new StepOutOfOrder()
  const drafted = await draftStep(db, ai, ctx, peek.spec, peek.step.position, instructions)
  return db.transaction(async (tx) => {
    const { step, spec } = await lockStep(tx, ctx, stepId, expected)
    if (step.status === 'pending') throw new StepOutOfOrder()
    await storeStep(tx, ctx, spec.agent_run_id, stepId, drafted, instructions)
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.agent_steps', entity_id: stepId, verb: 'redone', after: { instructions } }])
    return spec.id as string
  })
}

// Editing the text of a step sends it back for review: it cannot count as approved until approved again.
export async function editStep(db: Db, ctx: Actor, stepId: string, expected: number, text: string): Promise<string> {
  return db.transaction(async (tx) => {
    const { step, spec } = await lockStep(tx, ctx, stepId, expected)
    if (step.status === 'pending') throw new StepOutOfOrder()
    await tx.query(`update core.agent_steps set edited_text = $2, status = 'review', approved_by = null, approved_at = null, updated_by = $3 where id = $1`, [stepId, text, ctx.userId])
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.agent_steps', entity_id: stepId, verb: 'edited' }])
    return spec.id as string
  })
}

// Includes or excludes a theme. It applies to steps not yet started: drafted steps keep what they were written from.
export async function setThemeIncluded(db: Db, ctx: Actor, specId: string, themeId: string, included: boolean, expected: number): Promise<void> {
  await db.transaction(async (tx) => {
    const spec = await specRow(tx, ctx.workspaceId, specId)
    if (!spec) throw new SpecNotFound()
    if (spec.status === 'published') throw new SpecPublished()
    const r = await tx.query(`update delivery.specs set updated_by = $3 where id = $1 and version = $2 returning version`, [specId, expected, ctx.userId])
    if (!r.rows[0]) throw new SpecConflict(spec.version)
    const u = await tx.query(`update delivery.spec_themes set included = $3 where spec_id = $1 and theme_id = $2 returning theme_id`, [specId, themeId, included])
    if (!u.rows[0]) throw new SpecNotFound()
  })
}

// Publishing turns the document into the board: each in-scope theme becomes a requirement and a story, ordered as step
// 5 listed them (R1, R2 ...), and each held-out theme becomes an open question. Everything starts in To Do.
export async function publishSpec(db: Db, ctx: Actor, specId: string, expected: number): Promise<{ requirements: number; openQuestions: number; projectId: string }> {
  return db.transaction(async (tx) => {
    const spec = await specRow(tx, ctx.workspaceId, specId)
    if (!spec) throw new SpecNotFound()
    if (spec.status === 'published') throw new SpecPublished()
    if (spec.version !== expected) throw new SpecConflict(spec.version)
    const open = (await tx.query(`select count(*)::int n from core.agent_steps where run_id = $1 and status <> 'approved'`, [spec.agent_run_id])).rows[0].n as number
    if (open > 0) throw new NotAllApproved()

    const { inScope, outScope } = scopeThemes(await themesForSpec(tx, specId))
    const w = ctx.workspaceId
    const requirements = inScope.map((t, i) => ({ id: crypto.randomUUID(), t, key: `R${i + 1}` }))
    await insertMany(tx, 'delivery.requirements', requirements.map(({ id, t }) => ({
      id, workspace_id: w, spec_id: specId, theme_id: t.id, title: t.opp, category: Object.keys(CATEGORY_LABEL).find((k) => CATEGORY_LABEL[k] === t.cat), priority: t.prio.toLowerCase(), effort: t.eff, opportunity: t.opp, supporting_quote: t.quote || null,
      created_by: ctx.userId, updated_by: ctx.userId,
    })))
    const story = (key: string, kind: string, t: Scoped, title: string, requirementId: string | null, position: number) => ({
      workspace_id: w, spec_id: specId, requirement_id: requirementId, theme_id: t.id, kind, key, title, status: 'todo', position: position * 1000, priority: t.prio.toLowerCase(), owner_team: null,
      summary: t.opp + (t.quote ? ` "${t.quote}"` : ''), why_it_matters: `${t.title} was raised by ${t.ppl} of ${t.total} participants.`, next_step: 'Assign an owner and define acceptance criteria.', created_by: ctx.userId, updated_by: ctx.userId,
    })
    const stories = [
      ...requirements.map(({ id, t, key }, i) => story(key, 'requirement', t, t.opp, id, i + 1)),
      ...outScope.map((t, i) => story(`Q${i + 1}`, 'open_question', t, `Should "${t.title}" move into scope?`, null, requirements.length + i + 1)),
    ]
    await insertMany(tx, 'delivery.stories', stories)
    await tx.query(`update delivery.specs set status = 'published', published_at = now(), stale = false, updated_by = $2 where id = $1`, [specId, ctx.userId])
    await insertMany(tx, 'core.audit_log', [{ workspace_id: w, actor_id: ctx.userId, entity: 'delivery.specs', entity_id: specId, verb: 'published', after: { requirements: requirements.length, openQuestions: outScope.length } }])
    return { requirements: requirements.length, openQuestions: outScope.length, projectId: spec.project_id as string }
  })
}

export async function deleteSpec(db: Db, ctx: Actor, specId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const spec = await specRow(tx, ctx.workspaceId, specId)
    if (!spec) return false
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'delivery.specs', entity_id: specId, verb: 'deleted', before: { name: spec.name } }])
    await tx.query(`delete from delivery.specs where id = $1`, [specId])
    // A stand-alone document owns its project; deleting the document removes it too.
    if (spec.project_kind === 'standalone') await tx.query(`delete from core.projects where id = $1 and kind = 'standalone'`, [spec.project_id])
    return true
  })
}

export { ApiError }
