// Proposing new feature areas: current themes that have no area, grouped by the word they share. When several themes, raised by
// several people, keep coming back around one word that no area covers, that word is probably an area nobody has named yet. No model
// is involved (plain words, shared/areas.ts), so it costs nothing and runs whenever the page is opened. A person accepts a proposal
// (the area is added and its themes are filed under it) or says not now (it is not offered again).
import type { Db, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { similarAreas, stem, tokens } from '../shared/areas.js'
import { createArea, listAreas } from './areas.js'
import { CURRENT_THEMES } from './insights.js'

/** A proposal needs at least this many themes, from this many different people, so one loud interview does not start an area. */
export const MIN_THEMES = 2
export const MIN_PARTICIPANTS = 3

export type AreaProposal = {
  /** The stem the group shares; the same proposal has the same key each time. */
  key: string
  name: string
  themes: { id: string; title: string }[]
  participants: number
  projects: number
}

export class ProposalMissing extends Error {}

type Row = { id: string; title: string; projectId: string; people: string[] }

const titleCase = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

/** The groups, strongest first. `existing` are the live areas, so a word an area already covers is never proposed again. */
export function groupThemes(rows: Row[], existing: { name: string; aliases: string[] }[], dismissed: Set<string> = new Set()): AreaProposal[] {
  const left = new Map(rows.map((r) => [r.id, r]))
  const words = (r: Row) => tokens(r.title).filter((w) => w.length >= 4)
  const out: AreaProposal[] = []
  for (;;) {
    // The word that the most remaining people used in theme titles.
    const byWord = new Map<string, Row[]>()
    for (const r of left.values()) for (const w of words(r)) byWord.set(w, [...(byWord.get(w) ?? []), r])
    const scored = [...byWord.entries()]
      .map(([w, rs]) => ({ w, rs, people: new Set(rs.flatMap((r) => r.people)).size }))
      .filter((g) => g.rs.length >= MIN_THEMES && g.people >= MIN_PARTICIPANTS)
      .sort((a, b) => b.people - a.people || b.rs.length - a.rs.length || a.w.localeCompare(b.w))
    const best = scored[0]
    if (!best) break
    for (const r of best.rs) left.delete(r.id)
    // A dismissed word still claims its themes, so their other shared words do not come back as a new suggestion.
    if (dismissed.has(best.w)) continue
    // The most used spelling of the stem in the titles becomes the name.
    const spellings = new Map<string, number>()
    for (const r of best.rs) for (const raw of r.title.toLowerCase().split(/[^a-z0-9]+/)) if (stem(raw) === best.w) spellings.set(raw, (spellings.get(raw) ?? 0) + 1)
    const spelled = [...spellings.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? best.w
    const name = titleCase(spelled)
    // An area already covers it: the person should file those themes under it, not add a second one.
    if (similarAreas(name, existing.map((e, i) => ({ id: String(i), name: e.name, aliases: e.aliases }))).length) continue
    out.push({ key: best.w, name, themes: best.rs.map((r) => ({ id: r.id, title: r.title })), participants: best.people, projects: new Set(best.rs.map((r) => r.projectId)).size })
  }
  return out
}

async function loadRows(db: Queryable, workspaceId: string): Promise<Row[]> {
  const rows = (
    await db.query(
      `select t.id, t.title, t.project_id,
              coalesce(array_agg(distinct coalesce(sp.participant_id::text, 'sp:' || lower(sp.name)) || '@' || t.project_id::text) filter (where sp.id is not null), '{}') as people
         from research.themes t join (${CURRENT_THEMES}) c on c.id = t.id
         left join research.theme_quotes tq on tq.theme_id = t.id
         left join research.utterances u on u.id = tq.utterance_id
         left join research.transcript_speakers sp on sp.id = u.speaker_id
        where t.area_id is null group by t.id, t.title, t.project_id order by t.created_at, t.title`,
      [workspaceId],
    )
  ).rows
  return rows.map((r) => ({ id: r.id as string, title: r.title as string, projectId: r.project_id as string, people: r.people as string[] }))
}

/** What the page offers now: groups of themes with no area that no live area covers and nobody has dismissed. */
export async function proposeAreas(db: Queryable, workspaceId: string): Promise<AreaProposal[]> {
  const [rows, areas, dismissed] = await Promise.all([
    loadRows(db, workspaceId),
    listAreas(db, workspaceId),
    db.query(`select key from insights.area_proposal_dismissals where workspace_id = $1`, [workspaceId]),
  ])
  const live = areas.filter((a) => !a.retired)
  return groupThemes(rows, live, new Set(dismissed.rows.map((r) => r.key as string)))
}

/** Adds the area and files the group's themes under it (editors). A group that has changed since the page loaded is recomputed; one that is gone is ProposalMissing. */
export async function acceptProposal(db: Db, ctx: RequestContext, key: string, name?: string): Promise<{ areaId: string; name: string; filed: number }> {
  const proposal = (await proposeAreas(db, ctx.workspaceId)).find((p) => p.key === key)
  if (!proposal) throw new ProposalMissing()
  const area = await createArea(db, ctx, { name: name?.trim() || proposal.name, definition: null, aliases: [], force: true })
  const filed = await db.transaction(async (tx) => {
    const done = await tx.query(`update research.themes set area_id = $2, updated_by = $3 where workspace_id = $4 and id = any($1::uuid[]) and area_id is null returning id`, [proposal.themes.map((t) => t.id), area.id, ctx.userId, ctx.workspaceId])
    await tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'insights.feature_areas', $3, 'proposal accepted', null, $4)`, [ctx.workspaceId, ctx.userId, area.id, JSON.stringify({ key, themes: done.rows.length })])
    return done.rows.length
  })
  return { areaId: area.id, name: area.name, filed }
}

export async function dismissProposal(db: Db, ctx: RequestContext, key: string): Promise<void> {
  await db.query(`insert into insights.area_proposal_dismissals (workspace_id, key, dismissed_by) values ($1, $2, $3) on conflict do nothing`, [ctx.workspaceId, key, ctx.userId])
}
