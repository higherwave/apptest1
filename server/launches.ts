// Launch: the go signals for a project's release. A launch has one section per step (product leadership, sales, legal, documentation, marketing, and
// the final decision); each section is answered by that step's reviewer, with a rationale and links to the evidence. Everyone with access reads every
// internal section; only a step's reviewer writes it. Answers are never overwritten: a new answer is a new row, and an answer given on an earlier
// brief shows as reopened. Who covers a step comes from shared/launch.mjs (reviewersFor), set up under Admin, Members, Reviewers.
import { isAnswerFor, isStep, LAUNCH_STEPS, rationaleRequired, reviewersFor, stepLabel, stepState, stepUsed, type Assignment } from '../shared/launch.mjs'
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { getProjectSummary } from './projects.js'
import { getSpec } from './specs.js'

export class LaunchNotFound extends Error {}
export class NoThemes extends Error {}
export class LaunchExists extends Error {}
export class NotTheReviewer extends Error {
  constructor(public who: string[]) {
    super('not the reviewer')
  }
}
export class StepNotUsed extends Error {}
export class BadAnswer extends Error {}
export class NeedsRationale extends Error {}
export class BadLink extends Error {}
export class LinkNotFound extends Error {}

export type Person = { userId: string; name: string; email: string }
export type OpenItem = { step: string; label: string; state: string; rationale: string | null }
export type LaunchAnswer = { id: string; answer: string; rationale: string; by: { id: string; name: string } | null; at: string; reopened: boolean; openItems: OpenItem[] | null }
export type LaunchLink = { id: string; title: string; url: string; addedBy: string | null; addedAt: string }
export type LaunchStep = {
  step: string
  label: string
  used: boolean
  /** waiting, missing (a step the team uses with no primary reviewer), not_used, reopened, or the current answer. */
  state: string
  reviewers: { primary: Person[]; alternate: Person[] }
  answer: LaunchAnswer | null
  /** Earlier answers on this step, newest first (the record keeps them). */
  earlier: LaunchAnswer[]
  links: LaunchLink[]
  canAnswer: boolean
}
export type Follower = { userId: string; name: string }

export async function followersOf(db: Queryable, launchId: string): Promise<Follower[]> {
  return (await db.query(`select u.id, u.display_name from delivery.launch_followers f join core.users u on u.id = f.user_id where f.launch_id = $1 order by lower(u.display_name)`, [launchId])).rows.map((r) => ({ userId: r.id as string, name: r.display_name as string }))
}

/** Internal members who could follow and are not yet following: an external member is never offered, because the digest carries quotes. */
export async function candidatesFor(db: Queryable, workspaceId: string, launchId: string): Promise<Follower[]> {
  return (
    await db.query(
      `select u.id, u.display_name from core.memberships m join core.users u on u.id = m.user_id
        where m.workspace_id = $1 and not m.is_external and u.id not in (select user_id from delivery.launch_followers where launch_id = $2)
        order by lower(u.display_name)`,
      [workspaceId, launchId],
    )
  ).rows.map((r) => ({ userId: r.id as string, name: r.display_name as string }))
}

export async function lastShared(db: Queryable, launchId: string): Promise<{ at: string; by: string | null; emailed: number; inSlack: boolean } | null> {
  const r = (await db.query(`select d.shared_at, d.emailed, d.in_slack, u.display_name from delivery.launch_digests d left join core.users u on u.id = d.shared_by where d.launch_id = $1 order by d.shared_at desc limit 1`, [launchId])).rows[0]
  return r ? { at: new Date(r.shared_at).toISOString(), by: r.display_name ?? null, emailed: r.emailed, inSlack: r.in_slack } : null
}

export type ViewerKind = 'team' | 'leader' | 'reviewer' | 'external' | 'visitor'
export type LaunchDetail = {
  id: string
  projectId: string
  projectName: string
  teamId: string | null
  teamName: string | null
  name: string
  targetDate: string | null
  briefNotes: string
  /** When the brief last changed: the requirements were published, or the notes were edited. */
  briefAt: string
  you: { kind: ViewerKind; canSetUp: boolean; steps: string[] }
  /** The team's Slack channel, and the launch's thread in it once it has one. Nothing for an external reviewer. */
  slack: { channel: string | null; started: boolean; threadUrl: string | null }
  /** Who follows the launch, who could, and the last digest shared with them. Nothing for an external reviewer. */
  follow: { followers: Follower[]; candidates: Follower[]; lastShared: { at: string; by: string | null; emailed: number; inSlack: boolean } | null }
  steps: LaunchStep[]
  summary: {
    /** preparing, or the final decision's answer, or reopened. */
    state: string
    counts: { ready: number; conditions: number; changes: number; notApplicable: number; waiting: number; missing: number; reopened: number }
    blocking: { step: string; label: string; state: string }[]
    waitingOn: { step: string; label: string }[]
  }
  brief: { published: boolean; requirements: { key: string; title: string; priority: string }[]; problem: string | null; users: string | null; goals: string[] | null }
}
export type LaunchListItem = { id: string; projectId: string; projectName: string; teamName: string | null; name: string; targetDate: string | null; state: string; yourSteps: string[]; waitingOnYou: string[] }

type Row = { id: string; project_id: string; name: string; target_date: string | null; brief_notes: string; notes_updated_at: string; project_name: string; team_id: string | null; team_name: string | null; slack_channel: string | null; slack_thread_ts: string | null; slack_permalink: string | null }
const LAUNCH_SQL = `
  select l.id, l.project_id, l.name, to_char(l.target_date, 'YYYY-MM-DD') as target_date, l.brief_notes, l.notes_updated_at, p.name as project_name, p.team_id, t.name as team_name,
    t.slack_channel, l.slack_thread_ts, l.slack_permalink
  from delivery.launches l join core.projects p on p.id = l.project_id left join core.teams t on t.id = p.team_id`

const audit = (tx: Queryable, ctx: RequestContext, entity: 'delivery.launches' | 'delivery.launch_answers' | 'delivery.launch_links', id: string, verb: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.workspaceId, ctx.userId, entity, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

const iso = (d: unknown) => new Date(d as string).toISOString()

// Who covers what, loaded once per request.
type Cover = { assignments: Assignment[]; people: Map<string, Person>; off: Map<string, string[]> }
async function loadCover(db: Queryable, workspaceId: string): Promise<Cover> {
  const rows = (
    await db.query(
      `select ra.user_id, ra.step, ra.team_id, ra.role, u.display_name, u.email from core.reviewer_assignments ra join core.users u on u.id = ra.user_id where ra.workspace_id = $1`,
      [workspaceId],
    )
  ).rows
  const off = new Map<string, string[]>()
  for (const r of (await db.query(`select s.team_id, s.step from core.team_launch_steps s join core.teams t on t.id = s.team_id where t.workspace_id = $1 and not s.used`, [workspaceId])).rows) {
    off.set(r.team_id, [...(off.get(r.team_id) ?? []), r.step])
  }
  return {
    assignments: rows.map((r) => ({ userId: r.user_id, step: r.step, teamId: r.team_id ?? null, role: r.role })),
    people: new Map(rows.map((r) => [r.user_id as string, { userId: r.user_id as string, name: r.display_name as string, email: r.email as string }])),
    off,
  }
}

type Viewer = { kind: ViewerKind; canSetUp: boolean; steps: string[] }

/** What the caller is to this launch, or null when it is not theirs to see (the route then answers 404). */
function viewerOf(ctx: RequestContext, row: Row, cover: Cover): Viewer | null {
  const off = row.team_id ? (cover.off.get(row.team_id) ?? []) : []
  const steps = ctx.anonymous
    ? []
    : LAUNCH_STEPS.filter((s) => {
        if (!stepUsed(off, s.key) || !row.team_id) return false
        const who = reviewersFor(cover.assignments, row.team_id, s.key)
        return who.primary.includes(ctx.userId) || who.alternate.includes(ctx.userId)
      }).map((s) => s.key)
  const teamRole = row.team_id && !ctx.anonymous ? ctx.teams[row.team_id] : undefined
  // An external member reaches only the steps they are assigned, never the team's own screens.
  if (ctx.external) return steps.length ? { kind: 'external', canSetUp: false, steps } : null
  if (ctx.anonymous) return { kind: 'visitor', canSetUp: false, steps: [] }
  if (teamRole) return { kind: 'team', canSetUp: teamRole === 'editor' || teamRole === 'owner', steps }
  if (steps.length) return { kind: 'reviewer', canSetUp: false, steps }
  if (ctx.role === 'owner') return { kind: 'leader', canSetUp: false, steps }
  return null
}

async function currentBrief(db: Queryable, row: Row): Promise<{ key: string; at: string; specId: string | null }> {
  const spec = (await db.query(`select id, published_at from delivery.specs where project_id = $1 and status = 'published' order by published_at desc limit 1`, [row.project_id])).rows[0]
  const notesAt = iso(row.notes_updated_at)
  const key = `${spec?.id ?? 'none'}|${spec?.published_at ? iso(spec.published_at) : ''}|${notesAt}`
  const at = spec?.published_at && new Date(spec.published_at) > new Date(row.notes_updated_at) ? iso(spec.published_at) : notesAt
  return { key, at, specId: spec?.id ?? null }
}

async function build(db: Queryable, ctx: RequestContext, row: Row, cover: Cover, viewer: Viewer, withBrief: boolean): Promise<LaunchDetail> {
  const off = row.team_id ? (cover.off.get(row.team_id) ?? []) : []
  const brief = await currentBrief(db, row)
  const answerRows = (
    await db.query(
      `select a.id, a.step, a.answer, a.rationale, a.brief_key, a.open_items, a.answered_at, a.answered_by, u.display_name
         from delivery.launch_answers a left join core.users u on u.id = a.answered_by where a.launch_id = $1 order by a.answered_at desc, a.id`,
      [row.id],
    )
  ).rows
  const linkRows = (
    await db.query(`select l.id, l.step, l.title, l.url, l.added_at, u.display_name from delivery.launch_links l left join core.users u on u.id = l.added_by where l.launch_id = $1 order by l.added_at`, [row.id])
  ).rows
  const toAnswer = (a: Record<string, any>): LaunchAnswer => ({
    id: a.id, answer: a.answer, rationale: a.rationale, by: a.answered_by ? { id: a.answered_by, name: a.display_name ?? 'Someone' } : null, at: iso(a.answered_at),
    reopened: a.brief_key !== brief.key, openItems: Array.isArray(a.open_items) ? a.open_items : null,
  })
  const person = (id: string) => cover.people.get(id)!
  const external = viewer.kind === 'external'
  const all: LaunchStep[] = LAUNCH_STEPS.map((s) => {
    const used = stepUsed(off, s.key)
    const who = row.team_id ? reviewersFor(cover.assignments, row.team_id, s.key) : { primary: [], alternate: [] }
    const mine = answerRows.filter((a) => a.step === s.key).map(toAnswer)
    const current = mine[0] ?? null
    return {
      step: s.key,
      label: s.label,
      used,
      state: stepState({ used, hasPrimary: who.primary.length > 0, answer: current?.answer ?? null, reopened: !!current?.reopened }),
      reviewers: { primary: who.primary.map(person), alternate: who.alternate.map(person) },
      answer: current,
      earlier: mine.slice(1, 6),
      links: linkRows.filter((l) => l.step === s.key).map((l) => ({ id: l.id, title: l.title, url: l.url, addedBy: l.display_name ?? null, addedAt: iso(l.added_at) })),
      canAnswer: used && viewer.steps.includes(s.key),
    }
  })
  // An external reviewer sees only their own sections; everyone else sees every step the team uses (and a step turned off, so it is explained).
  const steps = external ? all.filter((s) => viewer.steps.includes(s.step)) : all
  const counted = all.filter((s) => s.used && s.step !== 'final_decision')
  const n = (...states: string[]) => counted.filter((s) => states.includes(s.state)).length
  const final = all.find((s) => s.step === 'final_decision')!
  const summary: LaunchDetail['summary'] = {
    state: final.state === 'reopened' ? 'reopened' : ['go', 'go_with_conditions', 'no_go'].includes(final.state) ? final.state : 'preparing',
    counts: { ready: n('ready'), conditions: n('ready_with_conditions'), changes: n('changes_needed'), notApplicable: n('not_applicable'), waiting: n('waiting'), missing: n('missing'), reopened: n('reopened') },
    blocking: counted.filter((s) => ['changes_needed', 'missing', 'reopened'].includes(s.state)).map((s) => ({ step: s.step, label: s.label, state: s.state })),
    waitingOn: counted.filter((s) => s.state === 'waiting').map((s) => ({ step: s.step, label: s.label })),
  }
  let published = false
  let requirements: LaunchDetail['brief']['requirements'] = []
  let problem: string | null = null
  let users: string | null = null
  let goals: string[] | null = null
  if (withBrief && !external && brief.specId) {
    published = true
    requirements = (
      await db.query(`select key, title, priority from delivery.stories where spec_id = $1 and kind = 'requirement'`, [brief.specId])
    ).rows
      .map((r) => ({ key: r.key as string, title: r.title as string, priority: r.priority as string }))
      .sort((a, b) => Number(a.key.replace(/\D/g, '')) - Number(b.key.replace(/\D/g, '')))
    const spec = await getSpec(db, ctx.workspaceId, brief.specId)
    problem = spec?.brief.problem ?? null
    users = spec?.brief.users ?? null
    goals = spec?.brief.goals ?? null
  }
  return {
    id: row.id, projectId: row.project_id, projectName: row.project_name, teamId: row.team_id, teamName: row.team_name, name: row.name, targetDate: row.target_date,
    briefNotes: row.brief_notes, briefAt: brief.at, you: viewer,
    slack: external ? { channel: null, started: false, threadUrl: null } : { channel: row.slack_channel, started: !!row.slack_thread_ts, threadUrl: row.slack_permalink },
    follow: external ? { followers: [], candidates: [], lastShared: null } : { followers: await followersOf(db, row.id), candidates: viewer.canSetUp ? await candidatesFor(db, ctx.workspaceId, row.id) : [], lastShared: await lastShared(db, row.id) },
    steps, summary: external ? { ...summary, counts: { ready: 0, conditions: 0, changes: 0, notApplicable: 0, waiting: 0, missing: 0, reopened: 0 }, blocking: [], waitingOn: [] } : summary,
    brief: { published, requirements, problem, users, goals },
  }
}

/**
 * Every launch as the system sees it (all sections, all reviewers, nothing hidden), for messages that go out without a caller: who to ask, who answered,
 * what is waiting. Never returned by a route.
 */
export async function launchForSystem(db: Queryable, workspaceId: string, id: string): Promise<(LaunchDetail & { createdBy: Person | null }) | null> {
  const row = (await db.query(`${LAUNCH_SQL} where l.id = $1 and l.workspace_id = $2`, [id, workspaceId])).rows[0] as Row | undefined
  if (!row) return null
  const cover = await loadCover(db, workspaceId)
  const ctx = { workspaceId, userId: '', anonymous: false, external: false, role: 'owner', teams: {} } as unknown as RequestContext
  const detail = await build(db, ctx, row, cover, { kind: 'leader', canSetUp: false, steps: [] }, false)
  const by = (await db.query(`select u.id, u.display_name, u.email from delivery.launches l join core.users u on u.id = l.created_by where l.id = $1`, [id])).rows[0]
  return { ...detail, createdBy: by ? { userId: by.id, name: by.display_name, email: by.email } : null }
}

/** The ids of every launch (with their workspace), for the hourly sweep. */
export async function allLaunchIds(db: Queryable): Promise<{ id: string; workspaceId: string }[]> {
  return (await db.query(`select id, workspace_id from delivery.launches order by created_at`)).rows.map((r) => ({ id: r.id as string, workspaceId: r.workspace_id as string }))
}

/** The launch as the caller may see it, or null (not theirs, or none). */
export async function getLaunch(db: Queryable, ctx: RequestContext, id: string): Promise<LaunchDetail | null> {
  const row = (await db.query(`${LAUNCH_SQL} where l.id = $1 and l.workspace_id = $2`, [id, ctx.workspaceId])).rows[0] as Row | undefined
  if (!row) return null
  const cover = await loadCover(db, ctx.workspaceId)
  const viewer = viewerOf(ctx, row, cover)
  return viewer ? build(db, ctx, row, cover, viewer, true) : null
}

/** The launch of a project, for a caller who may see the project; and whether they may start one. */
export async function getProjectLaunch(db: Queryable, ctx: RequestContext, projectId: string): Promise<{ launch: LaunchDetail | null; canCreate: boolean; whyNot: string | null }> {
  const row = (await db.query(`${LAUNCH_SQL} where l.project_id = $1 and l.workspace_id = $2`, [projectId, ctx.workspaceId])).rows[0] as Row | undefined
  if (row) {
    const cover = await loadCover(db, ctx.workspaceId)
    const viewer = viewerOf(ctx, row, cover)
    return { launch: viewer ? await build(db, ctx, row, cover, viewer, true) : null, canCreate: false, whyNot: null }
  }
  const project = (await db.query(`select team_id from core.projects where id = $1 and workspace_id = $2`, [projectId, ctx.workspaceId])).rows[0]
  const teamRole = project?.team_id && !ctx.anonymous ? ctx.teams[project.team_id] : undefined
  const themes = (await getProjectSummary(db, ctx.workspaceId, projectId))?.themes ?? 0
  if (teamRole !== 'editor' && teamRole !== 'owner') return { launch: null, canCreate: false, whyNot: 'Only an editor of the project’s team can start its launch.' }
  if (themes === 0) return { launch: null, canCreate: false, whyNot: 'A launch can start once the project has themes.' }
  return { launch: null, canCreate: true, whyNot: null }
}

/** Every launch the caller may see, with their own part in it. */
export async function listLaunches(db: Queryable, ctx: RequestContext): Promise<LaunchListItem[]> {
  const rows = (await db.query(`${LAUNCH_SQL} where l.workspace_id = $1 order by p.name`, [ctx.workspaceId])).rows as Row[]
  const cover = await loadCover(db, ctx.workspaceId)
  const out: LaunchListItem[] = []
  for (const row of rows) {
    const viewer = viewerOf(ctx, row, cover)
    if (!viewer) continue
    const d = await build(db, ctx, row, cover, viewer, false)
    out.push({
      id: d.id, projectId: d.projectId, projectName: d.projectName, teamName: d.teamName, name: d.name, targetDate: d.targetDate, state: d.summary.state, yourSteps: viewer.steps,
      waitingOnYou: d.steps.filter((s) => s.canAnswer && (s.state === 'waiting' || s.state === 'reopened')).map((s) => s.step),
    })
  }
  return out
}

export async function createLaunch(db: Db, ctx: RequestContext, projectId: string, input: { name?: string; targetDate?: string | null; briefNotes?: string }): Promise<string> {
  const project = (await db.query(`select name from core.projects where id = $1 and workspace_id = $2`, [projectId, ctx.workspaceId])).rows[0]
  if (!project) throw new LaunchNotFound()
  if (((await getProjectSummary(db, ctx.workspaceId, projectId))?.themes ?? 0) === 0) throw new NoThemes()
  return db.transaction(async (tx) => {
    if ((await tx.query(`select 1 from delivery.launches where project_id = $1`, [projectId])).rows[0]) throw new LaunchExists()
    const name = input.name?.trim() || project.name
    const made = (
      await tx.query(
        `insert into delivery.launches (workspace_id, project_id, name, target_date, brief_notes, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $6) returning id`,
        [ctx.workspaceId, projectId, name, input.targetDate ?? null, input.briefNotes ?? '', ctx.userId],
      )
    ).rows[0]
    await audit(tx, ctx, 'delivery.launches', made.id, 'created', null, { name, project: project.name })
    return made.id as string
  })
}

/** Name, target date and the brief notes: the launch owner's. A change to the notes is a change to the brief, which reopens answers. */
export async function setUpLaunch(db: Db, ctx: RequestContext, id: string, patch: { name?: string; targetDate?: string | null; briefNotes?: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const row = (await tx.query(`select id, name, to_char(target_date, 'YYYY-MM-DD') as target_date, brief_notes from delivery.launches where id = $1 and workspace_id = $2 for update`, [id, ctx.workspaceId])).rows[0]
    if (!row) throw new LaunchNotFound()
    const name = patch.name?.trim() || row.name
    const date = patch.targetDate === undefined ? row.target_date : patch.targetDate
    const notes = patch.briefNotes === undefined ? row.brief_notes : patch.briefNotes
    const notesChanged = notes !== row.brief_notes
    await tx.query(
      `update delivery.launches set name = $2, target_date = $3, brief_notes = $4, notes_updated_at = case when $5 then now() else notes_updated_at end, updated_by = $6 where id = $1`,
      [id, name, date, notes, notesChanged, ctx.userId],
    )
    const before = { name: row.name, targetDate: row.target_date, ...(notesChanged ? { briefNotes: row.brief_notes } : {}) }
    const after = { name, targetDate: date, ...(notesChanged ? { briefNotes: notes } : {}) }
    if (JSON.stringify(before) !== JSON.stringify(after)) await audit(tx, ctx, 'delivery.launches', id, notesChanged ? 'brief changed' : 'updated', before, after)
  })
}

async function reviewerOrThrow(db: Queryable, ctx: RequestContext, launchId: string, step: string): Promise<{ row: Row; cover: Cover; viewer: Viewer }> {
  if (!isStep(step)) throw new BadAnswer()
  const row = (await db.query(`${LAUNCH_SQL} where l.id = $1 and l.workspace_id = $2`, [launchId, ctx.workspaceId])).rows[0] as Row | undefined
  if (!row) throw new LaunchNotFound()
  const cover = await loadCover(db, ctx.workspaceId)
  const viewer = viewerOf(ctx, row, cover)
  if (!viewer) throw new LaunchNotFound()
  const off = row.team_id ? (cover.off.get(row.team_id) ?? []) : []
  if (!stepUsed(off, step)) throw new StepNotUsed()
  if (!viewer.steps.includes(step)) {
    const who = row.team_id ? reviewersFor(cover.assignments, row.team_id, step) : { primary: [], alternate: [] }
    throw new NotTheReviewer([...who.primary, ...who.alternate].map((id) => cover.people.get(id)?.name ?? 'Someone'))
  }
  return { row, cover, viewer }
}

/** A step's reviewer gives their answer. It is added to the record; earlier answers stay. The final decision keeps the open items it went past. */
export async function answerStep(db: Db, ctx: RequestContext, launchId: string, step: string, input: { answer: string; rationale: string }): Promise<void> {
  const { row, cover, viewer } = await reviewerOrThrow(db, ctx, launchId, step)
  if (!isAnswerFor(step, input.answer)) throw new BadAnswer()
  const rationale = input.rationale.trim()
  if (rationaleRequired(input.answer) && !rationale) throw new NeedsRationale()
  const brief = await currentBrief(db, row)
  let openItems: OpenItem[] | null = null
  if (step === 'final_decision') {
    const detail = await build(db, ctx, row, cover, viewer, false)
    openItems = detail.steps
      .filter((s) => s.used && s.step !== 'final_decision' && !['ready', 'not_applicable'].includes(s.state))
      .map((s) => ({ step: s.step, label: s.label, state: s.state, rationale: s.answer?.rationale || null }))
  }
  await db.transaction(async (tx) => {
    const made = (
      await tx.query(
        `insert into delivery.launch_answers (launch_id, step, answer, rationale, brief_key, open_items, answered_by) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
        [launchId, step, input.answer, rationale, brief.key, openItems ? JSON.stringify(openItems) : null, ctx.userId],
      )
    ).rows[0]
    await audit(tx, ctx, 'delivery.launch_answers', made.id, 'answered', null, { launch: row.name, step: stepLabel(step), answer: input.answer, rationale })
  })
}

const httpUrl = (u: string) => {
  try {
    const p = new URL(u)
    return p.protocol === 'http:' || p.protocol === 'https:'
  } catch {
    return false
  }
}

export async function addLink(db: Db, ctx: RequestContext, launchId: string, step: string, input: { title?: string; url: string }): Promise<void> {
  const { row } = await reviewerOrThrow(db, ctx, launchId, step)
  const url = input.url.trim()
  if (!httpUrl(url)) throw new BadLink()
  const title = input.title?.trim() || new URL(url).hostname
  await db.transaction(async (tx) => {
    const made = (await tx.query(`insert into delivery.launch_links (launch_id, step, title, url, added_by) values ($1, $2, $3, $4, $5) returning id`, [launchId, step, title, url, ctx.userId])).rows[0]
    await audit(tx, ctx, 'delivery.launch_links', made.id, 'added', null, { launch: row.name, step: stepLabel(step), title, url })
  })
}

export async function removeLink(db: Db, ctx: RequestContext, launchId: string, linkId: string): Promise<void> {
  const link = (await db.query(`select l.id, l.step, l.title, l.url from delivery.launch_links l join delivery.launches x on x.id = l.launch_id where l.id = $1 and l.launch_id = $2 and x.workspace_id = $3`, [linkId, launchId, ctx.workspaceId])).rows[0]
  if (!link) throw new LinkNotFound()
  const { row } = await reviewerOrThrow(db, ctx, launchId, link.step)
  await db.transaction(async (tx) => {
    await tx.query(`delete from delivery.launch_links where id = $1`, [linkId])
    await audit(tx, ctx, 'delivery.launch_links', linkId, 'removed', { launch: row.name, step: stepLabel(link.step), title: link.title, url: link.url }, null)
  })
}
