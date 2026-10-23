import { EFFORT, STEP_TITLES, THEMES } from '../shared/stub-config.mjs'
import { callAiWithFallback, simulatedProvider, type Ai, type AiProvider } from './ai.js'
import { ANALYSIS_PROMPT_VERSION, loadAnalysisInput, TranscriptsTooLarge } from './ai-analysis.js'
import type { Db } from './db.js'
import { ApiError } from './errors.js'
import { insertMany } from './sql.js'
import { claimVersion, ProjectNotFound, VersionConflict, type Actor } from './versioning.js'
import { transcriptsKey } from './transcripts.js'

// The simulated analysis: the prototype's keyword matching over the project's transcripts. Its theme
// definitions and effort estimates are the prototype's own (shared/stub-config.mjs).
// A real model replaces this behind the same input and output; nothing else changes.
const CATEGORY: Record<string, string> = { 'Pain point': 'pain_point', Need: 'need', Expectation: 'expectation', Delight: 'delight' }

export type AnalysisResult = { runId: string; themes: number; steps: string[]; /** Set when the live model could not be used and the simulation ran instead. */ fallback?: 'budget' | 'credit' }
export class NoTranscripts extends Error {}

// A run still "running" after this long is treated as dead (the function was cut off), so it cannot block the project forever.
const STALE_RUN_MINUTES = 10

// Runs one analysis over every transcript in the project and stores it as a new run. The previous run is kept
// but retired, so a published requirements document that cites its themes is flagged stale, not broken. The
// person's edits belong to a run, so the new run starts clean, as in the prototype.
// The model call happens before the transaction opens, so a slow call never holds a database connection, and the run is
// recorded as 'running' first: a second start on the same project is refused (409 run_in_progress) rather than paid for twice.
export async function runAnalysis(db: Db, ai: Ai, ctx: Actor, projectId: string, expected: number): Promise<AnalysisResult> {
  const project = (await db.query(`select version from core.projects where id = $1 and workspace_id = $2 and kind = 'research'`, [projectId, ctx.workspaceId])).rows[0]
  if (!project) throw new ProjectNotFound()
  if (project.version !== expected) throw new VersionConflict(project.version as number)
  const transcripts = (await db.query(`select id, name, raw_text, content_hash from research.transcripts where project_id = $1 order by position, name`, [projectId])).rows
  if (!transcripts.length) throw new NoTranscripts()
  const participants = (await db.query(`select name from research.participants where project_id = $1 order by position`, [projectId])).rows as { name: string }[]

  const runId = crypto.randomUUID()
  await db.query(`update core.agent_runs set status = 'failed' where project_id = $1 and kind = 'analysis' and status = 'running' and started_at < now() - make_interval(mins => $2)`, [projectId, STALE_RUN_MINUTES])
  try {
    await db.query(
      `insert into core.agent_runs (id, workspace_id, project_id, kind, status, input_hash, provider, prompt_version, created_by, updated_by)
       values ($1, $2, $3, 'analysis', 'running', $4, $5, $6, $7, $7)`,
      [runId, ctx.workspaceId, projectId, transcriptsKey(transcripts as { name: string; content_hash: string }[]), ai.provider.name, ai.provider.live ? ANALYSIS_PROMPT_VERSION : 'keyword-v1', ctx.userId],
    )
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new ApiError(409, 'run_in_progress', 'An analysis is already running for this project.')
    throw err
  }

  try {
    const { value: themes, fallback } = await callAiWithFallback(
      db, ai, ctx.workspaceId, 'analysis',
      async (p) => {
        if (!p.analyzeProject) return p.analyze(transcripts.map((t) => ({ name: t.name as string, text: t.raw_text as string })), participants, THEMES, EFFORT)
        const r = await p.analyzeProject(await loadAnalysisInput(db, projectId))
        return { value: r.value.themes, usage: r.usage }
      },
      runId,
    )
    // The monthly budget or the account's credit is used up: the simulation ran instead, and the run says so.
    if (fallback) await db.query(`update core.agent_runs set provider = $2, prompt_version = 'keyword-v1' where id = $1`, [runId, simulatedProvider.name])
    const result = await store(db, ctx, projectId, expected, runId, themes)
    return fallback ? { ...result, fallback } : result
  } catch (err) {
    await db.query(`update core.agent_runs set status = 'failed' where id = $1`, [runId]).catch(() => undefined)
    // Nothing was stored, so the current analysis is untouched. Say plainly what went wrong.
    if (err instanceof TranscriptsTooLarge) throw new ApiError(422, 'transcripts_too_large', 'These transcripts are too long for one analysis. Remove some and try again.', 'transcripts')
    throw err
  }
}

async function store(db: Db, ctx: Actor, projectId: string, expected: number, runId: string, themes: Awaited<ReturnType<AiProvider['analyze']>>['value']): Promise<AnalysisResult> {
  return db.transaction(async (tx) => {
    await claimVersion(tx, ctx, projectId, expected)
    const transcripts = (await tx.query(`select id from research.transcripts where project_id = $1 order by position, name`, [projectId])).rows
    await tx.query(`update core.agent_runs set status = 'complete', finished_at = now() where id = $1`, [runId])
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
