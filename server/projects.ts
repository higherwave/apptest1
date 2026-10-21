import type { Db, Queryable } from './db.js'
import type { CreateProjectInput } from './schemas.js'
import { DEFAULT_STAGES, TINTS } from './schemas.js'
import { insertMany } from './sql.js'

// New projects take tints in the order the prototype hands them out.
const PALETTE = ['cream', 'mint', 'coral', 'yellow', 'lavender', 'sky', 'blue', 'rose'] as const satisfies readonly (typeof TINTS)[number][]

export type ProjectSummary = {
  id: string
  name: string
  color: string
  template: string | null
  status: 'draft' | 'analyzed'
  sessions: number
  themes: number
  highPriority: number
  createdAt: string
  version: number
}

// Themes are counted from the project's current analysis run only: the latest completed run that no
// newer run has replaced. Status is derived from that count, never stored.
const LIST_SQL = `
  select p.id, p.name, p.color, tpl.name as template, p.created_at, p.version,
         (select count(*) from research.transcripts tr where tr.project_id = p.id)::int as sessions,
         coalesce(t.themes, 0)::int as themes,
         coalesce(t.high, 0)::int as high_priority
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
    status: r.themes > 0 ? 'analyzed' : 'draft',
    sessions: r.sessions,
    themes: r.themes,
    highPriority: r.high_priority,
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
    await insertMany(tx, 'research.studies', [{
      project_id: projectId, workspace_id: w, what_testing: input.what, jtbd_when: input.jtbd.when, jtbd_want: input.jtbd.want, jtbd_so: input.jtbd.so,
      outcomes: input.outcomes, methods: input.methods, created_by: ctx.userId, updated_by: ctx.userId,
    }])
    await insertMany(tx, 'research.study_stages', DEFAULT_STAGES.map((name, position) => ({ workspace_id: w, study_id: projectId, position, name })))
    await insertMany(tx, 'research.participants', input.participants.map((p) => ({
      workspace_id: w, project_id: projectId, name: p.name, role: p.role, email: p.email.toLowerCase(), session_date: p.sessionDate, created_by: ctx.userId, updated_by: ctx.userId,
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
