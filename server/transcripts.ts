import { createHash } from 'node:crypto'
import { parseTranscript } from '../shared/providers.mjs'
import type { Db, Queryable } from './db.js'
import { claimVersion, type Actor } from './versioning.js'
import { insertMany } from './sql.js'
import { ApiError } from './errors.js'
import type { SaveTranscriptsInput } from './schemas.js'

export type TranscriptRow = {
  id: string
  name: string
  platform: 'zoom' | 'meet' | 'teams' | null
  rawText: string
  lineCount: number
  speakers: { name: string; role: 'participant' | 'moderator'; participant: string | null }[]
}
export type TranscriptList = { transcripts: TranscriptRow[]; hasAnalysis: boolean; needsAnalysis: boolean; analyzedAt: string | null }

// The analysis is identified by the transcripts it read: their names and content hashes, in order.
export const transcriptsKey = (rows: { name: string; content_hash: string }[]) =>
  createHash('sha256').update(rows.map((r) => `${r.name}:${r.content_hash}`).join('|')).digest('hex')

export async function currentAnalysisRun(db: Queryable, projectId: string) {
  return (
    await db.query(
      `select id, input_hash, finished_at from core.agent_runs
       where project_id = $1 and kind = 'analysis' and status = 'complete' and superseded_at is null
       order by started_at desc limit 1`,
      [projectId],
    )
  ).rows[0] as { id: string; input_hash: string | null; finished_at: Date | null } | undefined
}

export async function listTranscripts(db: Queryable, projectId: string): Promise<TranscriptList> {
  const rows = (await db.query(`select id, name, platform, raw_text, content_hash from research.transcripts where project_id = $1 order by position, name`, [projectId])).rows
  const speakers = (
    await db.query(
      `select s.transcript_id, s.name, s.role, p.name as participant,
              (select min(u.position) from research.utterances u where u.speaker_id = s.id) as first_line
       from research.transcript_speakers s
       join research.transcripts t on t.id = s.transcript_id
       left join research.participants p on p.id = s.participant_id
       where t.project_id = $1 order by first_line, s.name`,
      [projectId],
    )
  ).rows
  const lines = (await db.query(`select u.transcript_id, count(*)::int n from research.utterances u join research.transcripts t on t.id = u.transcript_id where t.project_id = $1 group by 1`, [projectId])).rows
  const run = await currentAnalysisRun(db, projectId)
  return {
    transcripts: rows.map((r) => ({
      id: r.id,
      name: r.name,
      platform: r.platform ?? null,
      rawText: r.raw_text,
      lineCount: lines.find((l) => l.transcript_id === r.id)?.n ?? 0,
      speakers: speakers.filter((s) => s.transcript_id === r.id).map((s) => ({ name: s.name, role: s.role, participant: s.participant ?? null })),
    })),
    hasAnalysis: !!run,
    needsAnalysis: rows.length > 0 && (!run || run.input_hash !== transcriptsKey(rows as { name: string; content_hash: string }[])),
    analyzedAt: run?.finished_at ? new Date(run.finished_at).toISOString() : null,
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex')

// Splits a transcript into speakers and lines. A speaker is matched to a participant by name (case-insensitive);
// anyone whose name contains moderator, interviewer, researcher or facilitator is a moderator.
async function writeParsed(tx: Queryable, ctx: Actor, projectId: string, transcriptId: string, text: string, participants: { id: string; name: string }[]) {
  const parsed = parseTranscript(text)
  const speakerIds = new Map<string, string>()
  const speakerRows: Record<string, unknown>[] = []
  for (const line of parsed) {
    const key = line.who.toLowerCase()
    if (speakerIds.has(key)) continue
    const id = crypto.randomUUID()
    speakerIds.set(key, id)
    const match = line.mod ? undefined : participants.find((p) => p.name.toLowerCase() === key)
    speakerRows.push({ id, workspace_id: ctx.workspaceId, transcript_id: transcriptId, name: line.who, role: line.mod ? 'moderator' : 'participant', participant_id: match?.id ?? null })
  }
  await insertMany(tx, 'research.transcript_speakers', speakerRows)
  await insertMany(
    tx,
    'research.utterances',
    parsed.map((line, i) => ({ workspace_id: ctx.workspaceId, transcript_id: transcriptId, speaker_id: speakerIds.get(line.who.toLowerCase()), position: i + 1, timestamp_label: line.ts || null, text: line.text })),
  )
  return parsed.length
}

export class UnknownTranscript extends Error {}

// Transcripts are matched by id: an unchanged one is left alone, an edited one is re-parsed, a new one is added,
// and one left out is removed. If none are left, the current analysis is retired, so the Analyze steps lock again.
export async function saveTranscripts(db: Db, ctx: Actor, projectId: string, expected: number, input: SaveTranscriptsInput): Promise<void> {
  await db.transaction(async (tx) => {
    await claimVersion(tx, ctx, projectId, expected)
    const existing = new Map((await tx.query(`select id, name, platform, content_hash from research.transcripts where project_id = $1`, [projectId])).rows.map((r) => [r.id as string, r]))
    const participants = (await tx.query(`select id, name from research.participants where project_id = $1`, [projectId])).rows as { id: string; name: string }[]
    const keep = new Set<string>()

    for (const [position, t] of input.transcripts.entries()) {
      const hash = sha(t.rawText)
      if (t.id) {
        const row = existing.get(t.id)
        if (!row) throw new UnknownTranscript(t.id)
        keep.add(t.id)
        const changed = row.content_hash !== hash
        await tx.query(`update research.transcripts set name = $2, platform = $3, position = $4, content_hash = $5, raw_text = $6, updated_by = $7 where id = $1`, [t.id, t.name, t.platform, position, hash, t.rawText, ctx.userId])
        if (changed) {
          await tx.query(`delete from research.transcript_speakers where transcript_id = $1`, [t.id]) // cascades to its lines
          if ((await writeParsed(tx, ctx, projectId, t.id, t.rawText, participants)) === 0) throw noSpeakerLines(position)
        }
      } else {
        const id = (
          await tx.query(
            `insert into research.transcripts (workspace_id, project_id, position, name, platform, raw_text, content_hash, created_by, updated_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $8) returning id`,
            [ctx.workspaceId, projectId, position, t.name, t.platform, t.rawText, hash, ctx.userId],
          )
        ).rows[0].id as string
        if ((await writeParsed(tx, ctx, projectId, id, t.rawText, participants)) === 0) throw noSpeakerLines(position)
      }
    }

    const remove = [...existing.keys()].filter((id) => !keep.has(id))
    if (remove.length) await tx.query(`delete from research.transcripts where id = any($1::uuid[])`, [remove])
    if (input.transcripts.length === 0) {
      await tx.query(`update core.agent_runs set superseded_at = now() where project_id = $1 and kind = 'analysis' and superseded_at is null`, [projectId])
      await tx.query(`update delivery.specs set stale = true where project_id = $1`, [projectId])
    }
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.projects', entity_id: projectId, verb: 'transcripts_saved', after: { count: input.transcripts.length } }])
  })
}

const noSpeakerLines = (index: number) =>
  new ApiError(422, 'validation_failed', 'No speaker lines were found. Each line should look like "Name: what they said", optionally after a timestamp.', `transcripts.${index}.rawText`)
