import type { Db, Queryable } from './db.js'
import type { CreateProjectInput, SavePlanInput, SaveTasksInput } from './schemas.js'
import { DEFAULT_STAGES, TINTS } from './schemas.js'
import { insertMany } from './sql.js'
import { claimVersion } from './versioning.js'

// New projects take tints in the order the prototype hands them out.
const PALETTE = ['cream', 'mint', 'coral', 'yellow', 'lavender', 'sky', 'blue', 'rose'] as const satisfies readonly (typeof TINTS)[number][]

export type ProjectSummary = {
  id: string
  name: string
  color: string
  template: string | null
  /** The research methods chosen in the test plan, in the order saved. */
  methods: string[]
  status: 'draft' | 'analyzed'
  sessions: number
  themes: number
  highPriority: number
  /** Requirements with a metric or a finding recorded in the Measure step. */
  measurements: number
  createdAt: string
  version: number
}

// Themes are counted from the project's current analysis run only: the latest completed run that no
// newer run has replaced. Status is derived from that count, never stored.
const LIST_SQL = `
  select p.id, p.name, p.color, tpl.name as template, p.created_at, p.version,
         coalesce((select st.methods from research.studies st where st.project_id = p.id), '{}') as methods,
         (select count(*) from research.transcripts tr where tr.project_id = p.id)::int as sessions,
         coalesce(t.themes, 0)::int as themes,
         coalesce(t.high, 0)::int as high_priority,
         (select count(*) from delivery.success_measures m
            join delivery.stories s on s.id = m.story_id and s.kind = 'requirement'
            join delivery.specs sp on sp.id = s.spec_id
           where sp.project_id = p.id and (m.metric is not null or jsonb_array_length(m.checkins) > 0))::int as measurements
  from core.projects p
  left join core.templates tpl on tpl.id = p.template_id
  left join lateral (
    select count(*) as themes, count(*) filter (where th.suggested_priority = 'high') as high
    from research.themes th
    where th.project_id = p.id
      and th.run_id = (
        select r.id from core.agent_runs r
        where r.project_id = p.id and r.kind = 'analysis' and r.status = 'complete' and r.superseded_at is null
        order by r.started_at desc limit 1)
  ) t on true
  where p.workspace_id = $1 and p.kind = 'research'
  order by p.created_at desc, p.name`

export async function listProjects(db: Queryable, workspaceId: string): Promise<ProjectSummary[]> {
  const { rows } = await db.query(LIST_SQL, [workspaceId])
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    template: r.template ?? null,
    methods: r.methods ?? [],
    status: r.themes > 0 ? 'analyzed' : 'draft',
    sessions: r.sessions,
    themes: r.themes,
    highPriority: r.high_priority,
    measurements: r.measurements,
    createdAt: new Date(r.created_at).toISOString(),
    version: r.version,
  }))
}

// Templates ----------------------------------------------------------------------------------------

export type TemplateSummary = {
  key: string
  name: string
  description: string | null
  what: string
  jtbd: { when: string; want: string; so: string }
  outcomes: string[]
  methods: string[]
  tasks: { prompt: string; followUps: string[] }[]
}

export async function listTemplates(db: Queryable, workspaceId: string): Promise<TemplateSummary[]> {
  const { rows } = await db.query(
    `select key, name, description, body from core.templates where workspace_id = $1 and kind = 'study' order by key`,
    [workspaceId],
  )
  const order = ['usability', 'discovery', 'concept', 'blank']
  return rows
    .map((r) => ({
      key: r.key as string,
      name: r.name as string,
      description: (r.description as string | null) ?? null,
      what: r.body.what ?? '',
      jtbd: { when: r.body.jWhen ?? '', want: r.body.jWant ?? '', so: r.body.jSo ?? '' },
      outcomes: r.body.outcomes ?? [],
      methods: r.body.methods ?? [],
      tasks: (r.body.tasks ?? []).map((t: { q: string; fups?: string[] }) => ({ prompt: t.q, followUps: t.fups ?? [] })),
    }))
    .sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
}

// Test items: replaced as a whole on every save, since nothing else refers to them.
type TestItemInput = { description: string | null; outcomes: string[] }
async function insertTestItems(tx: Queryable, ctx: { workspaceId: string; userId: string }, projectId: string, items: TestItemInput[]) {
  await insertMany(tx, 'research.test_items', items.map((i, position) => ({
    workspace_id: ctx.workspaceId, project_id: projectId, position, description: i.description, outcomes: i.outcomes, created_by: ctx.userId, updated_by: ctx.userId,
  })))
}

// Create and delete ----------------------------------------------------------------------------------

export class TemplateMissing extends Error {}

// Creates the project, its test plan, journey stages, participants and the template's starter tasks in
// one transaction, and records it in the audit log.
export async function createProject(db: Db, ctx: { workspaceId: string; userId: string }, input: CreateProjectInput): Promise<string> {
  return db.transaction(async (tx) => {
    const tpl = (await tx.query(`select id, body from core.templates where workspace_id = $1 and kind = 'study' and key = $2`, [ctx.workspaceId, input.templateKey])).rows[0]
    if (!tpl) throw new TemplateMissing(input.templateKey)

    // The next tint nobody in the workspace is using yet; once all are used, start over.
    const used = new Set((await tx.query(`select color from core.projects where workspace_id = $1`, [ctx.workspaceId])).rows.map((r) => r.color))
    const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[used.size % PALETTE.length]

    const projectId = (
      await tx.query(
        `insert into core.projects (workspace_id, name, color, kind, template_id, owner_id, created_by, updated_by)
         values ($1, $2, $3, 'research', $4, $5, $5, $5) returning id`,
        [ctx.workspaceId, input.name, color, tpl.id, ctx.userId],
      )
    ).rows[0].id as string

    const w = ctx.workspaceId
    await insertMany(tx, 'research.studies', [{ project_id: projectId, workspace_id: w, methods: input.methods, created_by: ctx.userId, updated_by: ctx.userId }])
    await insertTestItems(tx, ctx, projectId, input.testItems)
    await insertMany(tx, 'research.study_stages', DEFAULT_STAGES.map((name, position) => ({ workspace_id: w, study_id: projectId, position, name })))
    await insertMany(tx, 'research.participants', input.participants.map((p, position) => ({
      workspace_id: w, project_id: projectId, position, name: p.name, role: p.role, email: p.email.toLowerCase(), phone: p.phone, session_date: p.sessionDate, created_by: ctx.userId, updated_by: ctx.userId,
    })))

    // Starter tasks from the template: each question, then its follow-ups as children.
    const tasks: { q: string; fups?: string[] }[] = tpl.body.tasks ?? []
    for (const [i, t] of tasks.entries()) {
      const parent = (await tx.query(`insert into research.tasks (workspace_id, project_id, position, prompt) values ($1, $2, $3, $4) returning id`, [w, projectId, i, t.q])).rows[0].id
      await insertMany(tx, 'research.tasks', (t.fups ?? []).map((f, j) => ({ workspace_id: w, project_id: projectId, parent_task_id: parent, position: j, prompt: f })))
    }

    await insertMany(tx, 'core.audit_log', [{ workspace_id: w, actor_id: ctx.userId, entity: 'core.projects', entity_id: projectId, verb: 'created', after: { name: input.name, template: input.templateKey } }])
    return projectId
  })
}

// Hard delete: foreign keys cascade to everything under the project. The audit log keeps the name,
// who deleted it and when, because it has no foreign key to the project.
export async function deleteProject(db: Db, ctx: { workspaceId: string; userId: string }, projectId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const row = (await tx.query(`select name from core.projects where id = $1 and workspace_id = $2 and kind = 'research'`, [projectId, ctx.workspaceId])).rows[0]
    if (!row) return false
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.projects', entity_id: projectId, verb: 'deleted', before: { name: row.name } }])
    await tx.query(`delete from core.projects where id = $1`, [projectId])
    return true
  })
}

export async function getProjectSummary(db: Queryable, workspaceId: string, projectId: string): Promise<ProjectSummary | undefined> {
  return (await listProjects(db, workspaceId)).find((p) => p.id === projectId)
}

// Detail, step availability and saves -----------------------------------------------------------------

export type ProjectDetail = ProjectSummary & {
  study: { methods: string[] }
  testItems: { id: string; description: string | null; outcomes: string[] }[]
  stages: { position: number; name: string }[]
  participants: { id: string; name: string; role: string | null; email: string; phone: string | null; sessionDate: string | null }[]
  tasks: { id: string; prompt: string; followUps: { id: string; prompt: string }[] }[]
}

export async function getProjectDetail(db: Queryable, workspaceId: string, projectId: string): Promise<ProjectDetail | undefined> {
  const summary = await getProjectSummary(db, workspaceId, projectId)
  if (!summary) return undefined
  const study = (await db.query(`select methods from research.studies where project_id = $1`, [projectId])).rows[0]
  const items = (await db.query(`select id, description, outcomes from research.test_items where project_id = $1 order by position`, [projectId])).rows
  const stages = (await db.query(`select position, name from research.study_stages where study_id = $1 order by position`, [projectId])).rows
  const participants = (await db.query(`select id, name, role, email, phone, session_date::text as session_date from research.participants where project_id = $1 order by position, name`, [projectId])).rows
  const tasks = (await db.query(`select id, parent_task_id, prompt from research.tasks where project_id = $1 order by position`, [projectId])).rows
  return {
    ...summary,
    study: { methods: study?.methods ?? [] },
    testItems: items.map((i) => ({ id: i.id, description: i.description ?? null, outcomes: i.outcomes ?? [] })),
    stages: stages.map((s) => ({ position: s.position, name: s.name })),
    participants: participants.map((p) => ({ id: p.id, name: p.name, role: p.role ?? null, email: p.email, phone: p.phone ?? null, sessionDate: p.session_date ?? null })),
    tasks: tasks
      .filter((t) => !t.parent_task_id)
      .map((t) => ({ id: t.id, prompt: t.prompt, followUps: tasks.filter((f) => f.parent_task_id === t.id).map((f) => ({ id: f.id, prompt: f.prompt })) })),
  }
}

export type StepKey = 'plan' | 'tasks' | 'transcripts' | 'themes' | 'journey' | 'prio' | 'requirements' | 'design' | 'stories' | 'measure'
export type StageInfo = { tabs: Record<StepKey, { enabled: boolean; hint: string | null }> }

// The server decides which steps are open, so the page never re-derives the rules:
//   Plan, Task List, Transcripts: always (the project exists).
//   Themes, Journey Map, Priorities, Requirements: the current analysis has at least one theme.
//   Design, Stories and Measure: a requirements document of this project is published.
export async function getProjectStage(db: Queryable, workspaceId: string, projectId: string): Promise<StageInfo | undefined> {
  const summary = await getProjectSummary(db, workspaceId, projectId)
  if (!summary) return undefined
  const published = (await db.query(`select exists (select 1 from delivery.specs where project_id = $1 and status = 'published') as published`, [projectId])).rows[0].published as boolean
  const analyzed = summary.themes > 0
  const open = { enabled: true, hint: null }
  const needAnalysis = { enabled: analyzed, hint: analyzed ? null : 'Save and analyze a transcript first' }
  return {
    tabs: {
      plan: open, tasks: open, transcripts: open,
      themes: needAnalysis, journey: needAnalysis, prio: needAnalysis, requirements: needAnalysis,
      design: { enabled: published, hint: published ? null : 'Publish the requirements first' },
      stories: { enabled: published, hint: published ? null : 'Publish the requirements first' },
      measure: { enabled: published, hint: published ? null : 'Publish the requirements first' },
    },
  }
}

export { ProjectNotFound, VersionConflict } from './versioning.js'

const audit = (tx: Queryable, ctx: { workspaceId: string; userId: string }, projectId: string, verb: string, after: Record<string, unknown>) =>
  insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.projects', entity_id: projectId, verb, after }])

export class UnknownParticipant extends Error {}

// Saves the whole test plan page in one go, against one version: name, methods, test items and participants.
// Participants are matched by id: existing ones are updated in place (so speakers matched to them stay matched), new ones
// are added, and ones left out are removed. Order follows the list.
export async function savePlan(db: Db, ctx: { workspaceId: string; userId: string }, projectId: string, expected: number, input: SavePlanInput): Promise<void> {
  await db.transaction(async (tx) => {
    await claimVersion(tx, ctx, projectId, expected, input.name)
    await tx.query(`update research.studies set methods = $2, updated_by = $3 where project_id = $1`, [projectId, input.methods, ctx.userId])
    await tx.query(`delete from research.test_items where project_id = $1`, [projectId])
    await insertTestItems(tx, ctx, projectId, input.testItems)

    const existing = new Set((await tx.query(`select id from research.participants where project_id = $1`, [projectId])).rows.map((r) => r.id as string))
    const keep = new Set<string>()
    for (const [position, p] of input.participants.entries()) {
      if (p.id) {
        if (!existing.has(p.id)) throw new UnknownParticipant(p.id)
        keep.add(p.id)
        await tx.query(
          `update research.participants set name = $2, role = $3, email = $4, phone = $5, session_date = $6, position = $7, updated_by = $8 where id = $1`,
          [p.id, p.name, p.role, p.email.toLowerCase(), p.phone, p.sessionDate, position, ctx.userId],
        )
      } else {
        await tx.query(
          `insert into research.participants (workspace_id, project_id, position, name, role, email, phone, session_date, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
          [ctx.workspaceId, projectId, position, p.name, p.role, p.email.toLowerCase(), p.phone, p.sessionDate, ctx.userId],
        )
      }
    }
    const remove = [...existing].filter((id) => !keep.has(id))
    if (remove.length) await tx.query(`delete from research.participants where id = any($1::uuid[])`, [remove])
    await audit(tx, ctx, projectId, 'plan_saved', { name: input.name, testItems: input.testItems.length, participants: input.participants.length })
  })
}

// Tasks have no outside references, so the list is replaced as a whole, questions then follow-ups.
export async function saveTasks(db: Db, ctx: { workspaceId: string; userId: string }, projectId: string, expected: number, input: SaveTasksInput): Promise<void> {
  await db.transaction(async (tx) => {
    await claimVersion(tx, ctx, projectId, expected)
    await tx.query(`delete from research.tasks where project_id = $1`, [projectId])
    for (const [i, t] of input.tasks.entries()) {
      const parent = (await tx.query(`insert into research.tasks (workspace_id, project_id, position, prompt, created_by, updated_by) values ($1, $2, $3, $4, $5, $5) returning id`, [ctx.workspaceId, projectId, i, t.prompt, ctx.userId])).rows[0].id
      await insertMany(tx, 'research.tasks', t.followUps.map((f, j) => ({ workspace_id: ctx.workspaceId, project_id: projectId, parent_task_id: parent, position: j, prompt: f, created_by: ctx.userId, updated_by: ctx.userId })))
    }
    await audit(tx, ctx, projectId, 'tasks_saved', { count: input.tasks.length })
  })
}
