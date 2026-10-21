import type { Db } from './db.js'

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

export async function listProjects(db: Db, workspaceId: string): Promise<ProjectSummary[]> {
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
