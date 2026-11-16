// Everything a workspace holds, as a download. The promise is that a customer can take their data away at any time, so this is complete by
// construction: every table that carries a workspace id is written out whole (as JSON), so a table added later is in the export without anyone
// remembering it. Beside the raw data sit readable files for people (transcripts, themes, requirements, launch answers), the audit log and the
// AI usage as spreadsheets, and a manifest with the row counts so the contents can be checked.
//
// Only the workspace asking is ever read: the database itself limits every query to that workspace (row-level security), and the test in
// export.test.ts checks that nothing of another workspace is in the file. What is never written: the encrypted Slack and Jira tokens.
import type { Queryable } from './db.js'
import { zip, type ZipFile } from './zip.js'

/** Columns that are never exported, by table: secrets (even encrypted ones) are not data the customer needs, and leave with the connection. */
const REDACT: Record<string, string[]> = { 'core.workspace_integrations': ['secret_enc'], 'core.trash': ['payload'] } // the Trash lists what is in it; restore an item to include its content

type Row = Record<string, any>
type Tables = Record<string, Row[]>

export async function dataTables(db: Queryable): Promise<{ schema: string; name: string }[]> {
  const { rows } = await db.query(
    `select c.table_schema as schema, c.table_name as name
       from information_schema.columns c
       join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.column_name = 'workspace_id' and c.table_schema in ('core', 'research', 'delivery', 'insights')
      order by 1, 2`,
  )
  return rows as { schema: string; name: string }[]
}

// --- spreadsheets ---------------------------------------------------------------------------------------------------------------
/** A cell as text. One that starts with = + - or @ would be run as a formula by a spreadsheet, so it is made plain text first. */
const cell = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export function toCsv(columns: string[], rows: Row[]): string {
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n'
}

export async function auditCsv(db: Queryable, workspaceId: string): Promise<string> {
  const { rows } = await db.query(
    `select a.created_at, coalesce(u.display_name, '') as actor, coalesce(u.email, '') as actor_email, a.entity, a.entity_id, a.verb, a.before::text as before, a.after::text as after
       from core.audit_log a left join core.users u on u.id = a.actor_id
      where a.workspace_id = $1 order by a.created_at desc, a.id`,
    [workspaceId],
  )
  return toCsv(['created_at', 'actor', 'actor_email', 'entity', 'entity_id', 'verb', 'before', 'after'], rows)
}

export async function aiUsageCsv(db: Queryable, workspaceId: string): Promise<string> {
  const { rows } = await db.query(
    `select created_at, purpose, provider, model, input_tokens, output_tokens, cost_usd, inference_geo, run_id from core.ai_usage where workspace_id = $1 order by created_at desc, id`,
    [workspaceId],
  )
  return toCsv(['created_at', 'purpose', 'provider', 'model', 'input_tokens', 'output_tokens', 'cost_usd', 'inference_geo', 'run_id'], rows)
}

// --- readable files ---------------------------------------------------------------------------------------------------------------
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'untitled'
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : '')
const by = (rows: Row[] | undefined, key: string) => (rows ?? []).slice().sort((a, b) => Number(a[key] ?? 0) - Number(b[key] ?? 0))
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])
const quoteBlock = (s: string) => s.split('\n').map((l) => `> ${l}`).join('\n')

export function readableFiles(t: Tables, people: Map<string, string>): ZipFile[] {
  const files: ZipFile[] = []
  const rows = (name: string) => t[name] ?? []
  const teams = new Map(rows('core.teams').map((r) => [r.id, r.name as string]))
  const utterances = new Map(rows('research.utterances').map((r) => [r.id, r]))
  const speakers = new Map(rows('research.transcript_speakers').map((r) => [`${r.transcript_id}|${r.id}`, r.name as string]))
  for (const p of rows('core.projects')) {
    const dir = `projects/${slug(p.name)}-${String(p.id).slice(0, 8)}`
    const study = rows('research.studies').find((s) => s.project_id === p.id)
    const parts = by(rows('research.participants').filter((x) => x.project_id === p.id), 'position')
    const overview = [
      `# ${p.name}`,
      '',
      `Team: ${teams.get(p.team_id) ?? ''}  `,
      `Created: ${day(p.created_at)}`,
      '',
      study ? `## What is being tested\n\n${study.what_testing ?? ''}\n\nWhen: ${study.jtbd_when ?? ''}  \nWant: ${study.jtbd_want ?? ''}  \nSo that: ${study.jtbd_so ?? ''}\n` : '',
      study && list(study.outcomes).length ? `## Outcomes\n\n${list(study.outcomes).map((o) => `- ${o}`).join('\n')}\n` : '',
      study && list(study.methods).length ? `## Methods\n\n${list(study.methods).map((o) => `- ${o}`).join('\n')}\n` : '',
      parts.length ? `## Participants\n\n${parts.map((x) => `- ${x.name}${x.role ? `, ${x.role}` : ''}${x.session_date ? ` (${day(x.session_date)})` : ''}`).join('\n')}\n` : '',
    ].filter((x) => x !== '').join('\n')
    files.push({ path: `${dir}/overview.md`, data: overview })

    for (const [i, tr] of by(rows('research.transcripts').filter((x) => x.project_id === p.id), 'position').entries()) {
      const lines = by(rows('research.utterances').filter((u) => u.transcript_id === tr.id), 'position').map(
        (u) => `${u.timestamp_label ? `[${u.timestamp_label}] ` : ''}${speakers.get(`${tr.id}|${u.speaker_id}`) ?? u.speaker_id ?? ''}: ${u.text}`,
      )
      files.push({ path: `${dir}/transcripts/${String(i + 1).padStart(2, '0')}-${slug(tr.name)}.txt`, data: `${tr.name}\n${tr.platform ?? ''}\n\n${lines.length ? lines.join('\n') : (tr.raw_text ?? '')}\n` })
    }

    const themes = rows('research.themes').filter((x) => x.project_id === p.id)
    if (themes.length) {
      const text = themes
        .slice()
        .sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0))
        .map((th) => {
          const quotes = rows('research.theme_quotes').filter((q) => q.theme_id === th.id).map((q) => utterances.get(q.utterance_id)?.text).filter(Boolean) as string[]
          return [`## ${th.title}`, '', `${th.category ?? ''}${th.severity ? ` · severity ${th.severity}` : ''}${th.score != null ? ` · score ${th.score}` : ''}`, '', th.description ?? '', th.opportunity ? `\nOpportunity: ${th.opportunity}` : '', ...quotes.map((q) => `\n${quoteBlock(q)}`), ''].join('\n')
        })
      files.push({ path: `${dir}/themes.md`, data: `# Themes: ${p.name}\n\n${text.join('\n')}` })
    }

    const specs = rows('delivery.specs').filter((x) => x.project_id === p.id)
    if (specs.length) {
      const text = specs.map((sp) => {
        const reqs = rows('delivery.requirements').filter((r) => r.spec_id === sp.id)
        const stories = rows('delivery.stories').filter((s) => s.spec_id === sp.id)
        return [
          `## ${sp.name} (${sp.status}${sp.published_at ? `, published ${day(sp.published_at)}` : ''})`,
          '',
          ...reqs.map((r) => `### ${r.title}\n\n${r.category ?? ''} · priority ${r.priority ?? ''} · effort ${r.effort ?? ''}\n\n${r.opportunity ?? ''}${r.supporting_quote ? `\n\n${quoteBlock(String(r.supporting_quote))}` : ''}\n`),
          stories.length ? `### Stories\n\n${by(stories, 'position').map((s) => `- ${s.key ? `${s.key}: ` : ''}${s.title} (${s.status})${s.summary ? `. ${s.summary}` : ''}`).join('\n')}\n` : '',
        ].join('\n')
      })
      files.push({ path: `${dir}/requirements.md`, data: `# Requirements: ${p.name}\n\n${text.join('\n')}` })
    }

    for (const l of rows('delivery.launches').filter((x) => x.project_id === p.id)) {
      const answers = rows('delivery.launch_answers').filter((a) => a.launch_id === l.id).sort((a, b) => String(a.answered_at).localeCompare(String(b.answered_at)))
      const text = [
        `# Launch: ${l.name}`,
        '',
        l.target_date ? `Target: ${day(l.target_date)}\n` : '',
        l.brief_notes ? `## Brief notes\n\n${l.brief_notes}\n` : '',
        '## Answers (every answer ever given, oldest first)\n',
        ...answers.map((a) => `- ${day(a.answered_at)} · ${a.step} · **${a.answer}** · ${people.get(a.answered_by) ?? ''}${a.rationale ? `\n  ${String(a.rationale).replace(/\n/g, '\n  ')}` : ''}`),
        '',
      ].join('\n')
      files.push({ path: `${dir}/launch-${slug(l.name)}.md`, data: text })
    }
  }
  return files
}

// --- the workspace ----------------------------------------------------------------------------------------------------------------
export type Exported = { fileName: string; bytes: Buffer; counts: Record<string, number> }

export async function exportWorkspace(db: Queryable, ws: { id: string; slug: string; name: string }, now: Date = new Date()): Promise<Exported> {
  const tables: Tables = {}
  const counts: Record<string, number> = {}
  const files: ZipFile[] = []
  for (const { schema, name } of await dataTables(db)) {
    const key = `${schema}.${name}`
    const hide = new Set(REDACT[key] ?? [])
    const { rows } = await db.query(`select * from ${schema}.${name} where workspace_id = $1 order by 1`, [ws.id])
    const clean = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !hide.has(k))))
    tables[key] = clean
    counts[key] = clean.length
    files.push({ path: `data/${key}.json`, data: JSON.stringify(clean, null, 1) })
  }
  const members = (await db.query(`select u.id, u.email, u.display_name, m.role, m.is_external, m.created_at from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 order by u.email`, [ws.id])).rows
  files.push({ path: 'data/members.json', data: JSON.stringify(members, null, 1) })
  counts['members'] = members.length
  const people = new Map<string, string>(members.map((m) => [m.id as string, String(m.display_name || m.email)]))
  files.push({ path: 'audit-log.csv', data: await auditCsv(db, ws.id) }, { path: 'ai-usage.csv', data: await aiUsageCsv(db, ws.id) })
  files.push(...readableFiles(tables, people))
  files.push({
    path: 'manifest.json',
    data: JSON.stringify({ workspace: ws.name, slug: ws.slug, exportedAt: now.toISOString(), rows: counts, secretsIncluded: false }, null, 1),
  })
  files.unshift({
    path: 'README.txt',
    data: [
      `Signal Flow data export for ${ws.name}`,
      `Made ${now.toISOString()}.`,
      '',
      'data/            Every table of your workspace as JSON: the complete record, in a form another system can read.',
      'projects/        One folder per project with readable files: the plan, the transcripts, the themes with their quotes, the requirements and stories, and the launch answers.',
      'audit-log.csv    What changed and who changed it (the last 12 months).',
      'ai-usage.csv     The AI calls made for this workspace and what they cost (the last 12 months).',
      'manifest.json    How many rows each table had, so the contents can be checked.',
      '',
      'Slack and Jira connection tokens are never exported. Documents such as the storyboard and requirements PDFs are made from this data on request, so they are not stored files.',
      '',
    ].join('\n'),
  })
  return { fileName: `signal-flow-${ws.slug}-${now.toISOString().slice(0, 10)}.zip`, bytes: zip(files, now), counts }
}
