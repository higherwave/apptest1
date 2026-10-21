import { analyze } from '../shared/providers.mjs'
import { EFFORT, STEP_TITLES, THEMES } from '../shared/stub-config.mjs'
import type { Db } from './db.js'
import { insertMany } from './sql.js'
import { claimVersion, type Actor } from './versioning.js'
import { transcriptsKey } from './transcripts.js'

// The simulated analysis: the prototype's keyword matching over the project's transcripts. Its theme
// definitions and effort estimates are the prototype's own (shared/stub-config.mjs).
// A real model replaces this behind the same input and output; nothing else changes.
const CATEGORY: Record<string, string> = { 'Pain point': 'pain_point', Need: 'need', Expectation: 'expectation', Delight: 'delight' }

export type AnalysisResult = { runId: string; themes: number; steps: string[] }
export class NoTranscripts extends Error {}

// Runs one analysis over every transcript in the project and stores it as a new run. The previous run is kept
// but retired, so a published requirements document that cites its themes is flagged stale, not broken. The
// person's pins and edits belong to a run, so the new run starts clean, as in the prototype.
export async function runAnalysis(db: Db, ctx: Actor, projectId: string, expected: number): Promise<AnalysisResult> {
  return db.transaction(async (tx) => {
    await claimVersion(tx, ctx, projectId, expected)
    const transcripts = (await tx.query(`select id, name, raw_text, content_hash from research.transcripts where project_id = $1 order by position, name`, [projectId])).rows
    if (!transcripts.length) throw new NoTranscripts()
    const participants = (await tx.query(`select name from research.participants where project_id = $1 order by position`, [projectId])).rows as { name: string }[]

    const themes = analyze(
      transcripts.map((t) => ({ name: t.name as string, text: t.raw_text as string })),
      participants,
      THEMES,
      EFFORT,
    )

    const runId = crypto.randomUUID()
    await tx.query(
      `insert into core.agent_runs (id, workspace_id, project_id, kind, status, input_hash, provider, prompt_version, finished_at, created_by, updated_by)
       values ($1, $2, $3, 'analysis', 'complete', $4, 'stub', 'keyword-v1', now(), $5, $5)`,
      [runId, ctx.workspaceId, projectId, transcriptsKey(transcripts as { name: string; content_hash: string }[]), ctx.userId],
    )
    await insertMany(
      tx,
      'core.agent_steps',
      STEP_TITLES.map((title, i) => ({ workspace_id: ctx.workspaceId, run_id: runId, position: i + 1, key: title.toLowerCase().replace(/[^a-z]+/g, '_'), title, status: 'approved' })),
    )

    // Each quote knows which transcript and which parsed line it came from; the line's position is its index + 1.
    const utterance = new Map<string, string>()
    for (const row of (await tx.query(`select u.id, u.transcript_id, u.position from research.utterances u join research.transcripts t on t.id = u.transcript_id where t.project_id = $1`, [projectId])).rows) {
      utterance.set(`${row.transcript_id}:${row.position}`, row.id)
    }
    const themeRows = themes.map((th) => ({ th, id: crypto.randomUUID() }))
    await insertMany(
      tx,
      'research.themes',
      themeRows.map(({ th, id }) => ({
        id, workspace_id: ctx.workspaceId, project_id: projectId, run_id: runId, title: th.title, category: CATEGORY[th.cat], stage_position: th.stage, severity: th.sev,
        description: th.desc, opportunity: th.opp, suggested_priority: th.prio.toLowerCase(), suggested_effort: th.eff, effort_note: th.effNote, score: Number(th.score.toFixed(4)),
        created_by: ctx.userId, updated_by: ctx.userId,
      })),
    )
    const quotes = themeRows.flatMap(({ th, id }) =>
      th.quotes.flatMap((q) => {
        const utteranceId = utterance.get(`${transcripts[q.t].id}:${q.u + 1}`)
        return utteranceId ? [{ theme_id: id, utterance_id: utteranceId, workspace_id: ctx.workspaceId }] : []
      }),
    )
    await insertMany(tx, 'research.theme_quotes', quotes)

    await tx.query(`update core.agent_runs set superseded_at = now() where project_id = $1 and kind = 'analysis' and id <> $2 and superseded_at is null`, [projectId, runId])
    await tx.query(`update delivery.specs set stale = true where project_id = $1`, [projectId])
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.projects', entity_id: projectId, verb: 'analysis_run', after: { runId, themes: themes.length } }])
    return { runId, themes: themes.length, steps: STEP_TITLES }
  })
}
