// Workflows: the service blueprint. A workflow has ordered stages; each stage has what good looks like, the signal to watch, the handoff out of it, and
// the backstage under it (teams, systems and processes, with owners). A person with edit access changes a workflow by saving the whole of it at once,
// against the version they were looking at; the audit log gets one entry per save, listing what changed. A project is on at most one workflow and maps
// each of its own journey stages to one of the workflow's stages, so its Journey Map can show that backstage.
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { ProjectNotFound } from './versioning.js'
import { SAMPLE_WORKFLOWS } from './workflow-samples.js'

export type BackstageKind = 'Team' | 'System' | 'Process'
export type WorkflowBackstage = { id: string; kind: BackstageKind; name: string; owner: string | null }
export type WorkflowStage = { id: string; position: number; name: string; good: string | null; signal: string | null; handoff: string | null; backstage: WorkflowBackstage[] }
export type Workflow = { id: string; name: string; description: string | null; version: number; projectCount: number; stages: WorkflowStage[] }
export type WorkflowInput = {
  name: string
  description: string | null
  stages: { id: string | null; name: string; good: string | null; signal: string | null; handoff: string | null; backstage: { id: string | null; kind: BackstageKind; name: string; owner: string | null }[] }[]
}

export class WorkflowMissing extends Error {}
export class WorkflowDuplicate extends Error {
  constructor(public name: string) {
    super(`"${name}" already exists.`)
  }
}
export class WorkflowConflict extends Error {
  constructor(public current: number) {
    super('workflow version conflict')
  }
}
export class WorkflowInUse extends Error {
  constructor(public projects: number) {
    super('workflow is in use')
  }
}
export class StageMissing extends Error {}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()
const orNull = (s: string | null) => (s && clean(s) ? clean(s) : null)
const audit = (tx: Queryable, ctx: RequestContext, entity: string, verb: string, id: string, before: unknown, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, $3, $4, $5, $6, $7)`, [
    ctx.workspaceId, ctx.userId, entity, id, verb, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after),
  ])

/** Every workflow with its stages and backstage, by name. */
export async function listWorkflows(db: Queryable, workspaceId: string, only?: string): Promise<Workflow[]> {
  const filter = only ? 'and w.id = $2' : ''
  const args = only ? [workspaceId, only] : [workspaceId]
  const [flows, stages, backstage] = await Promise.all([
    db.query(
      `select w.id, w.name, w.description, w.version, (select count(*)::int from insights.project_workflows p where p.workflow_id = w.id) as projects
       from insights.workflows w where w.workspace_id = $1 ${filter} order by lower(w.name)`,
      args,
    ),
    db.query(`select s.id, s.workflow_id, s.position, s.name, s.good, s.signal, s.handoff from insights.workflow_stages s join insights.workflows w on w.id = s.workflow_id where s.workspace_id = $1 ${filter} order by s.position`, args),
    db.query(
      `select b.id, b.stage_id, b.kind, b.name, b.owner from insights.workflow_backstage b join insights.workflow_stages s on s.id = b.stage_id join insights.workflows w on w.id = s.workflow_id
       where b.workspace_id = $1 ${filter} order by b.position`,
      args,
    ),
  ])
  const byStage = new Map<string, WorkflowBackstage[]>()
  for (const b of backstage.rows) byStage.set(b.stage_id, [...(byStage.get(b.stage_id) ?? []), { id: b.id, kind: b.kind, name: b.name, owner: b.owner ?? null }])
  const byFlow = new Map<string, WorkflowStage[]>()
  for (const s of stages.rows) byFlow.set(s.workflow_id, [...(byFlow.get(s.workflow_id) ?? []), { id: s.id, position: s.position, name: s.name, good: s.good ?? null, signal: s.signal ?? null, handoff: s.handoff ?? null, backstage: byStage.get(s.id) ?? [] }])
  return flows.rows.map((w) => ({ id: w.id, name: w.name, description: w.description ?? null, version: w.version, projectCount: w.projects, stages: byFlow.get(w.id) ?? [] }))
}

const getWorkflow = async (db: Queryable, workspaceId: string, id: string) => (await listWorkflows(db, workspaceId, id))[0]

async function assertNameFree(tx: Queryable, workspaceId: string, name: string, exceptId?: string) {
  const clash = (await tx.query(`select id from insights.workflows where workspace_id = $1 and lower(name) = lower($2) and ($3::uuid is null or id <> $3)`, [workspaceId, name, exceptId ?? null])).rows[0]
  if (clash) throw new WorkflowDuplicate(name)
}

/** Writes a workflow's stages and backstage. Ids that belong to this workflow are kept (so a project's stage mapping survives a rename); anything else is new; what is left out is removed. */
async function writeStages(tx: Queryable, ctx: RequestContext, workflowId: string, input: WorkflowInput) {
  const known = new Set((await tx.query(`select id from insights.workflow_stages where workflow_id = $1`, [workflowId])).rows.map((r) => r.id as string))
  const keep = new Set<string>()
  for (const [position, st] of input.stages.entries()) {
    const fields = [clean(st.name), orNull(st.good), orNull(st.signal), orNull(st.handoff)]
    let stageId: string
    if (st.id && known.has(st.id) && !keep.has(st.id)) {
      stageId = st.id
      await tx.query(`update insights.workflow_stages set position = $2, name = $3, good = $4, signal = $5, handoff = $6 where id = $1`, [stageId, position, ...fields])
    } else {
      stageId = (await tx.query(`insert into insights.workflow_stages (workspace_id, workflow_id, position, name, good, signal, handoff) values ($1, $2, $3, $4, $5, $6, $7) returning id`, [ctx.workspaceId, workflowId, position, ...fields])).rows[0].id
    }
    keep.add(stageId)
    const knownB = new Set((await tx.query(`select id from insights.workflow_backstage where stage_id = $1`, [stageId])).rows.map((r) => r.id as string))
    const keepB = new Set<string>()
    for (const [bp, b] of st.backstage.entries()) {
      const bFields = [b.kind, clean(b.name), orNull(b.owner)]
      if (b.id && knownB.has(b.id) && !keepB.has(b.id)) {
        keepB.add(b.id)
        await tx.query(`update insights.workflow_backstage set position = $2, kind = $3, name = $4, owner = $5 where id = $1`, [b.id, bp, ...bFields])
      } else {
        keepB.add((await tx.query(`insert into insights.workflow_backstage (workspace_id, stage_id, position, kind, name, owner) values ($1, $2, $3, $4, $5, $6) returning id`, [ctx.workspaceId, stageId, bp, ...bFields])).rows[0].id)
      }
    }
    await tx.query(`delete from insights.workflow_backstage where stage_id = $1 and not (id = any($2::uuid[]))`, [stageId, [...keepB]])
  }
  await tx.query(`delete from insights.workflow_stages where workflow_id = $1 and not (id = any($2::uuid[]))`, [workflowId, [...keep]])
}

async function insertWorkflow(tx: Queryable, ctx: RequestContext, input: WorkflowInput): Promise<string> {
  await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`workflows:${ctx.workspaceId}`])
  const name = clean(input.name)
  await assertNameFree(tx, ctx.workspaceId, name)
  const id = (await tx.query(`insert into insights.workflows (workspace_id, name, description, created_by, updated_by) values ($1, $2, $3, $4, $4) returning id`, [ctx.workspaceId, name, orNull(input.description), ctx.userId])).rows[0].id
  await writeStages(tx, ctx, id, input)
  await audit(tx, ctx, 'insights.workflows', 'created', id, null, { name, stages: input.stages.length })
  return id
}

export async function createWorkflow(db: Db, ctx: RequestContext, input: WorkflowInput): Promise<Workflow> {
  return db.transaction(async (tx) => (await getWorkflow(tx, ctx.workspaceId, await insertWorkflow(tx, ctx, input)))!)
}

/** Adds the healthcare examples that are not there yet (matched by name). Returns every workflow. */
export async function addSampleWorkflows(db: Db, ctx: RequestContext): Promise<Workflow[]> {
  return db.transaction(async (tx) => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`workflows:${ctx.workspaceId}`])
    for (const sample of SAMPLE_WORKFLOWS) {
      const there = (await tx.query(`select 1 from insights.workflows where workspace_id = $1 and lower(name) = lower($2)`, [ctx.workspaceId, sample.name])).rows[0]
      if (!there) await insertWorkflow(tx, ctx, sample)
    }
    return listWorkflows(tx, ctx.workspaceId)
  })
}

/** What a save changed, in plain lines for the audit log (at most twelve). */
export function diffWorkflow(before: Workflow, after: Workflow): string[] {
  const out: string[] = []
  if (before.name !== after.name) out.push(`Renamed the workflow: ${before.name} → ${after.name}`)
  if ((before.description ?? '') !== (after.description ?? '')) out.push('Changed the workflow description')
  const was = new Map(before.stages.map((s) => [s.id, s]))
  const now = new Map(after.stages.map((s) => [s.id, s]))
  for (const s of before.stages) if (!now.has(s.id)) out.push(`Removed stage ${s.name}`)
  for (const s of after.stages) {
    const old = was.get(s.id)
    if (!old) {
      out.push(`Added stage ${s.name}${s.backstage.length ? ` with ${s.backstage.length} backstage ${s.backstage.length === 1 ? 'entry' : 'entries'}` : ''}`)
      continue
    }
    if (old.name !== s.name) out.push(`Renamed stage ${old.name} → ${s.name}`)
    for (const [key, label] of [['good', 'what good looks like'], ['signal', 'the signal to watch'], ['handoff', 'the handoff']] as const) if ((old[key] ?? '') !== (s[key] ?? '')) out.push(`Changed ${label} of ${s.name}`)
    const oldB = new Map(old.backstage.map((b) => [b.id, b]))
    const newB = new Map(s.backstage.map((b) => [b.id, b]))
    for (const b of old.backstage) if (!newB.has(b.id)) out.push(`Removed ${b.kind.toLowerCase()} ${b.name} from ${s.name}`)
    for (const b of s.backstage) {
      const o = oldB.get(b.id)
      if (!o) out.push(`Added ${b.kind.toLowerCase()} ${b.name} to ${s.name}`)
      else if (o.name !== b.name || o.kind !== b.kind) out.push(`Changed ${o.name} to ${b.name} in ${s.name}`)
      else if ((o.owner ?? '') !== (b.owner ?? '')) out.push(`Changed the owner of ${b.name} in ${s.name}: ${o.owner ?? 'none'} → ${b.owner ?? 'none'}`)
    }
  }
  if (!out.length && before.stages.map((s) => s.id).join() !== after.stages.map((s) => s.id).join()) out.push('Reordered the stages')
  return out.length > 12 ? [...out.slice(0, 12), `…and ${out.length - 12} more`] : out
}

class NothingChanged extends Error {}

/** Saves the whole workflow against the version the person was looking at. A save that changes nothing is rolled back, so the version stays and two people saving the same thing do not conflict. */
export async function saveWorkflow(db: Db, ctx: RequestContext, id: string, expected: number, input: WorkflowInput): Promise<Workflow> {
  try {
    return await db.transaction(async (tx) => {
      await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`workflows:${ctx.workspaceId}`])
      const before = await getWorkflow(tx, ctx.workspaceId, id)
      if (!before) throw new WorkflowMissing()
      if (before.version !== expected) throw new WorkflowConflict(before.version)
      const name = clean(input.name)
      await assertNameFree(tx, ctx.workspaceId, name, id)
      await tx.query(`update insights.workflows set name = $3, description = $4, updated_by = $5 where workspace_id = $1 and id = $2`, [ctx.workspaceId, id, name, orNull(input.description), ctx.userId])
      await writeStages(tx, ctx, id, input)
      const after = (await getWorkflow(tx, ctx.workspaceId, id))!
      const changes = diffWorkflow(before, after)
      if (!changes.length) throw new NothingChanged()
      await audit(tx, ctx, 'insights.workflows', 'edited', id, null, { name: after.name, changes })
      return after
    })
  } catch (err) {
    if (err instanceof NothingChanged) return (await getWorkflow(db, ctx.workspaceId, id))!
    throw err
  }
}

/** Deletes a workflow nobody is using. A workflow that projects are on is refused: take them off it first. */
export async function deleteWorkflow(db: Db, ctx: RequestContext, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const before = await getWorkflow(tx, ctx.workspaceId, id)
    if (!before) throw new WorkflowMissing()
    if (before.projectCount > 0) throw new WorkflowInUse(before.projectCount)
    await tx.query(`delete from insights.workflows where workspace_id = $1 and id = $2`, [ctx.workspaceId, id])
    await audit(tx, ctx, 'insights.workflows', 'deleted', id, { name: before.name, stages: before.stages.length }, null)
  })
}

// A project on a workflow -----------------------------------------------------------------------------------

export type ProjectBlueprint = {
  workflow: { id: string; name: string } | null
  stages: { position: number; name: string; workflowStageId: string | null; workflowStage: WorkflowStage | null }[]
}

export async function projectBlueprint(db: Queryable, workspaceId: string, projectId: string): Promise<ProjectBlueprint> {
  const project = (await db.query(`select p.id, pw.workflow_id from core.projects p left join insights.project_workflows pw on pw.project_id = p.id where p.id = $1 and p.workspace_id = $2`, [projectId, workspaceId])).rows[0]
  if (!project) throw new ProjectNotFound()
  const stages = (await db.query(`select position, name, workflow_stage_id from research.study_stages where study_id = $1 and workspace_id = $2 order by position`, [projectId, workspaceId])).rows
  const workflow = project.workflow_id ? await getWorkflow(db, workspaceId, project.workflow_id) : undefined
  const byId = new Map((workflow?.stages ?? []).map((s) => [s.id, s]))
  return {
    workflow: workflow ? { id: workflow.id, name: workflow.name } : null,
    stages: stages.map((s) => ({ position: s.position, name: s.name, workflowStageId: byId.has(s.workflow_stage_id) ? s.workflow_stage_id : null, workflowStage: byId.get(s.workflow_stage_id) ?? null })),
  }
}

// "Confirm & pay" and "confirm and pay" are the same name; "Visit" is inside "Visit & follow-up".
const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
/** The workflow stage a project stage means, by name: an equal name, else the one stage whose name contains it or is contained by it. */
export function matchStage(name: string, stages: { id: string; name: string }[]): string | null {
  const n = norm(name)
  if (!n) return null
  const equal = stages.filter((s) => norm(s.name) === n)
  if (equal.length === 1) return equal[0].id
  const near = stages.filter((s) => {
    const m = norm(s.name)
    return Math.min(m.length, n.length) >= 4 && (m.includes(n) || n.includes(m))
  })
  return near.length === 1 ? near[0].id : null
}

/** Puts a project on a workflow (or takes it off), mapping its stages to the workflow's by name. Mapping is then editable stage by stage. */
export async function setProjectWorkflow(db: Db, ctx: RequestContext, projectId: string, workflowId: string | null): Promise<ProjectBlueprint> {
  return db.transaction(async (tx) => {
    const project = (await tx.query(`select id, name from core.projects where id = $1 and workspace_id = $2`, [projectId, ctx.workspaceId])).rows[0]
    if (!project) throw new ProjectNotFound()
    const current = (await tx.query(`select workflow_id from insights.project_workflows where project_id = $1`, [projectId])).rows[0]?.workflow_id ?? null
    if (current === workflowId) return projectBlueprint(tx, ctx.workspaceId, projectId)
    const flow = workflowId ? await getWorkflow(tx, ctx.workspaceId, workflowId) : undefined
    if (workflowId && !flow) throw new WorkflowMissing()
    await tx.query(`update research.study_stages set workflow_stage_id = null where study_id = $1`, [projectId])
    if (!flow) {
      await tx.query(`delete from insights.project_workflows where project_id = $1`, [projectId])
    } else {
      await tx.query(
        `insert into insights.project_workflows (project_id, workspace_id, workflow_id, updated_by) values ($1, $2, $3, $4)
         on conflict (project_id) do update set workflow_id = excluded.workflow_id, updated_by = excluded.updated_by, updated_at = now()`,
        [projectId, ctx.workspaceId, workflowId, ctx.userId],
      )
      const stages = (await tx.query(`select id, name from research.study_stages where study_id = $1`, [projectId])).rows
      for (const s of stages) {
        const match = matchStage(s.name, flow.stages)
        if (match) await tx.query(`update research.study_stages set workflow_stage_id = $2 where id = $1`, [s.id, match])
      }
    }
    const result = await projectBlueprint(tx, ctx.workspaceId, projectId)
    await audit(tx, ctx, 'core.projects', 'workflow set', projectId, null, { project: project.name, workflow: flow?.name ?? 'none', stagesMapped: result.stages.filter((s) => s.workflowStageId).length })
    return result
  })
}

/** Maps one of a project's journey stages to a stage of its workflow, or clears the mapping. */
export async function mapProjectStage(db: Db, ctx: RequestContext, projectId: string, position: number, workflowStageId: string | null): Promise<ProjectBlueprint> {
  return db.transaction(async (tx) => {
    const project = (await tx.query(`select p.id, p.name, pw.workflow_id from core.projects p left join insights.project_workflows pw on pw.project_id = p.id where p.id = $1 and p.workspace_id = $2`, [projectId, ctx.workspaceId])).rows[0]
    if (!project) throw new ProjectNotFound()
    const stage = (await tx.query(`select id, name from research.study_stages where study_id = $1 and position = $2`, [projectId, position])).rows[0]
    if (!stage) throw new StageMissing()
    let target: string | null = null
    if (workflowStageId) {
      const found = (await tx.query(`select id, name from insights.workflow_stages where id = $1 and workflow_id = $2`, [workflowStageId, project.workflow_id])).rows[0]
      if (!found) throw new StageMissing()
      target = found.name
    }
    await tx.query(`update research.study_stages set workflow_stage_id = $2 where id = $1`, [stage.id, workflowStageId])
    await audit(tx, ctx, 'core.projects', 'stage mapped', projectId, null, { project: project.name, stage: stage.name, workflowStage: target ?? 'none' })
    return projectBlueprint(tx, ctx.workspaceId, projectId)
  })
}
