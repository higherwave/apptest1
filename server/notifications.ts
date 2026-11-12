import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Db, Env, Queryable } from './db.js'
import type { Mailer } from './mailer.js'
import { listProjects, type ProjectSummary } from './projects.js'

// Notifications: one pipeline for every message the app sends a person (see migration 0035). A message has a KIND, a recipient and a
// dedupe key, and goes out through a channel (email only for now). The one kind today is the daily reminder to people who can edit and
// have a project with a step still to do. Approvals will add kinds ('approval.requested', 'approval.decided') beside it.

export const DIGEST = 'digest.incomplete_work'
/** The reminder goes out from this hour, in the recipient's own time zone. */
export const SEND_HOUR = 6
/** A scheduled run can arrive late (GitHub's scheduler often does), so a reminder still goes out up to this many hours after 6am. The dedupe key keeps it to one a day. */
export const CATCH_UP_HOURS = 3
/** After this many reminders in a row that say the same thing about a project, it stops mentioning that project. */
export const MAX_REPEATS = 3

// What is left on one project: Measure is deliberately not counted (it gets its own reminders later), so a project is done once its
// requirements are published and it has stories. Null when there is nothing to chase.
export type NextStep = { text: string; path: string; fingerprint: string }
export type SpecFacts = { exists: boolean; published: boolean }

export function nextStep(p: Pick<ProjectSummary, 'id' | 'status' | 'sessions' | 'highPriority'>, spec: SpecFacts): NextStep | null {
  const at = (step: string) => `/projects/${p.id}/${step}`
  const step = (text: string, path: string): NextStep => ({ text, path, fingerprint: `${path}|${text}` })
  if (p.status === 'draft') {
    return p.sessions > 0
      ? step(`Analyze the ${p.sessions} ${p.sessions === 1 ? 'session' : 'sessions'} to find themes`, at('transcripts'))
      : step('Finish the test plan and add sessions', at('plan'))
  }
  if (spec.published) return null
  if (spec.exists) return step('Finish and publish the requirements', at('requirements'))
  return p.highPriority > 0
    ? step(`${p.highPriority} high-priority ${p.highPriority === 1 ? 'theme' : 'themes'} to turn into requirements`, at('prio'))
    : step('Review the themes and set priorities', at('themes'))
}

export type DigestItem = { projectId: string; teamId: string | null; teamName?: string | null; name: string; text: string; path: string; fingerprint: string }

// Every project in the workspace that still has a step to do, in the order the project list shows them.
export async function openItems(db: Queryable, workspaceId: string): Promise<DigestItem[]> {
  const projects = await listProjects(db, workspaceId)
  const specs = (await db.query(`select project_id, bool_or(status = 'published') as published from delivery.specs where workspace_id = $1 group by project_id`, [workspaceId])).rows
  const facts = new Map<string, SpecFacts>(specs.map((r) => [r.project_id as string, { exists: true, published: !!r.published }]))
  const out: DigestItem[] = []
  for (const p of projects) {
    const s = nextStep(p, facts.get(p.id) ?? { exists: false, published: false })
    if (s) out.push({ projectId: p.id, teamId: p.teamId, teamName: p.teamName, name: p.name, ...s })
  }
  return out
}

// Who hears about a project. Today: everyone in the workspace who can edit (the workspace stands in for the team). When Teams arrives this
// is the one function that changes: it will return the editors of the project's team. It takes the project so that change needs no caller edits.
export const canEdit = `m.role in ('owner', 'editor')`

// Time helpers -----------------------------------------------------------------------------------------

export function localParts(now: Date, timeZone: string): { hour: number; date: string } | null {
  try {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', hour: 'numeric', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]),
    )
    return { hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` }
  } catch {
    return null
  }
}

export const validTimeZone = (tz: string): boolean => localParts(new Date(), tz) !== null

// Unsubscribe links ------------------------------------------------------------------------------------

// A link in the email turns the reminder off without signing in. It is signed with the sign-in secret, so only this app can make one.
const sign = (env: Env, userId: string) => (env.BETTER_AUTH_SECRET ? createHmac('sha256', env.BETTER_AUTH_SECRET).update(`unsubscribe:${DIGEST}:${userId}`).digest('hex') : null)
export function unsubscribeLink(env: Env, base: string, userId: string): string | null {
  const t = sign(env, userId)
  return t ? `${base}/api/v1/notifications/unsubscribe?u=${encodeURIComponent(userId)}&t=${t}` : null
}
export function unsubscribeValid(env: Env, userId: string, token: string): boolean {
  const want = sign(env, userId)
  if (!want || want.length !== token.length) return false
  return timingSafeEqual(Buffer.from(want), Buffer.from(token))
}

// The email ---------------------------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function composeDigest(opts: { name: string; items: DigestItem[]; base: string; settingsUrl: string; unsubscribe: string | null }) {
  const { items, base } = opts
  const first = opts.name.split(' ')[0] || 'there'
  const n = items.length
  const subject = `Signal Flow: ${n} ${n === 1 ? 'project is' : 'projects are'} waiting on you`
  const link = (i: DigestItem) => `${base}${i.path}`
  // Someone who edits in several teams gets the projects grouped under their team; with one team there is nothing to group.
  const teamNames = [...new Set(items.map((i) => i.teamName).filter((t): t is string => !!t))]
  const grouped = teamNames.length > 1
  const groups: { team: string | null; items: DigestItem[] }[] = grouped ? teamNames.sort((a, b) => a.localeCompare(b)).map((team) => ({ team, items: items.filter((i) => i.teamName === team) })) : [{ team: null, items }]
  const intro = `${n === 1 ? 'One project has' : `${n} projects have`} a next step:`
  const text = [
    `Hi ${first},`,
    '',
    intro,
    '',
    ...groups.flatMap((g) => [...(g.team ? [`${g.team}`] : []), ...g.items.map((i) => `- ${i.name}: ${i.text}\n  ${link(i)}`), ...(g.team ? [''] : [])]),
    '',
    `Change or stop these reminders: ${opts.settingsUrl}`,
    ...(opts.unsubscribe ? [`Unsubscribe in one click: ${opts.unsubscribe}`] : []),
  ].join('\n')
  const list = (xs: DigestItem[]) => ['<ul>', ...xs.map((i) => `<li><strong>${esc(i.name)}</strong>: <a href="${esc(link(i))}">${esc(i.text)}</a></li>`), '</ul>']
  const html = [
    `<p>Hi ${esc(first)},</p>`,
    `<p>${intro}</p>`,
    ...groups.flatMap((g) => [...(g.team ? [`<p><strong>${esc(g.team)}</strong></p>`] : []), ...list(g.items)]),
    `<p><small><a href="${esc(opts.settingsUrl)}">Change or stop these reminders</a>${opts.unsubscribe ? ` · <a href="${esc(opts.unsubscribe)}">Unsubscribe in one click</a>` : ''}</small></p>`,
  ].join('\n')
  return { subject, text, html }
}

// The run ---------------------------------------------------------------------------------------------------

export type DigestResult = {
  sent: number
  failed: number
  /** People who had nothing left to do (or nothing new to be told). */
  nothingToSay: number
  /** People already sent today's reminder. */
  alreadySent: number
  /** For a single forced run: what happened to that person. */
  outcome?: 'sent' | 'nothing_left' | 'failed'
  error?: string
}

type Recipient = { workspace_id: string; user_id: string; email: string; display_name: string; time_zone: string | null; enabled: boolean }

// Runs for everyone due now (the hourly cron), or, with `only`, for one person immediately ("Send me a reminder now": no 6am wait, no
// dedupe, no stop rule, not counted toward the stop rule, sent even when the person has switched the reminder off).
export async function runDigest(deps: { db: Db; env: Env; mailer: Mailer; now?: Date }, only?: { userId: string }): Promise<DigestResult> {
  const { db, env, mailer } = deps
  const now = deps.now ?? new Date()
  const result: DigestResult = { sent: 0, failed: 0, nothingToSay: 0, alreadySent: 0 }
  const base = (env.APP_URL || env.BETTER_AUTH_URL || '').replace(/\/$/, '')
  const people = (
    await db.query(
      `select m.workspace_id, u.id as user_id, u.email, u.display_name, u.time_zone, coalesce(np.enabled, true) as enabled
         from core.memberships m
         join core.users u on u.id = m.user_id
         left join core.notification_preferences np on np.user_id = u.id and np.kind = $1 and np.channel = 'email'
        where exists (select 1 from core.team_memberships tm where tm.user_id = u.id and tm.workspace_id = m.workspace_id and tm.role in ('owner', 'editor'))${only ? ' and u.id = $2' : ''}`,
      only ? [DIGEST, only.userId] : [DIGEST],
    )
  ).rows as Recipient[]

  const itemsByWorkspace = new Map<string, DigestItem[]>()
  for (const who of people) {
    let localDate = ''
    if (!only) {
      // Due only from the send hour (with a short catch-up) where they are, they have switched nothing off, and the address can be real.
      if (!who.enabled || !who.time_zone || /\.(example|test|invalid)$/i.test(who.email)) continue
      const local = localParts(now, who.time_zone)
      if (!local || local.hour < SEND_HOUR || local.hour >= SEND_HOUR + CATCH_UP_HOURS) continue
      localDate = local.date
    }
    if (!itemsByWorkspace.has(who.workspace_id)) itemsByWorkspace.set(who.workspace_id, await openItems(db, who.workspace_id))
    // Only projects of teams they edit: a project of another team is not theirs to be reminded about.
    const editing = new Set((await db.query(`select team_id from core.team_memberships where user_id = $1 and workspace_id = $2 and role in ('owner', 'editor')`, [who.user_id, who.workspace_id])).rows.map((r) => r.team_id as string))
    let items = itemsByWorkspace.get(who.workspace_id)!.filter((i) => i.teamId !== null && editing.has(i.teamId))
    const states = new Map<string, { fingerprint: string; sent_count: number }>()
    if (!only) {
      for (const r of (await db.query(`select project_id, fingerprint, sent_count from core.reminder_state where user_id = $1`, [who.user_id])).rows) states.set(r.project_id as string, { fingerprint: r.fingerprint as string, sent_count: r.sent_count as number })
      items = items.filter((i) => {
        const s = states.get(i.projectId)
        return !(s && s.fingerprint === i.fingerprint && s.sent_count >= MAX_REPEATS)
      })
    }
    if (!items.length) {
      result.nothingToSay++
      if (only) result.outcome = 'nothing_left'
      continue
    }

    const key = only ? `digest:now:${now.getTime()}` : `digest:${localDate}`
    // A retry after a failure may claim the row again; a row already sent or pending means this person has had today's.
    const claimed = (
      await db.query(
        `insert into core.notifications (workspace_id, recipient_id, kind, dedupe_key, payload) values ($1, $2, $3, $4, $5)
         on conflict (recipient_id, dedupe_key) do update set status = 'pending', error = null where core.notifications.status = 'failed'
         returning id`,
        [who.workspace_id, who.user_id, DIGEST, key, JSON.stringify({ projects: items.map((i) => ({ id: i.projectId, text: i.text })) })],
      )
    ).rows[0]
    if (!claimed) {
      result.alreadySent++
      continue
    }
    try {
      if (!base) throw new Error('APP_URL or BETTER_AUTH_URL is needed to build the links in the email.')
      await mailer.send({ to: who.email, ...composeDigest({ name: who.display_name, items, base, settingsUrl: `${base}/settings/notifications`, unsubscribe: unsubscribeLink(env, base, who.user_id) }) })
      await db.query(`update core.notifications set status = 'sent', sent_at = now() where id = $1`, [claimed.id])
      if (!only) {
        for (const i of items) {
          await db.query(
            `insert into core.reminder_state (user_id, project_id, fingerprint, sent_count, last_sent_on) values ($1, $2, $3, 1, $4)
             on conflict (user_id, project_id) do update set
               sent_count = case when core.reminder_state.fingerprint = excluded.fingerprint then core.reminder_state.sent_count + 1 else 1 end,
               fingerprint = excluded.fingerprint, last_sent_on = excluded.last_sent_on`,
            [who.user_id, i.projectId, i.fingerprint, localDate],
          )
        }
      }
      result.sent++
      if (only) result.outcome = 'sent'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('reminder email failed', err instanceof Error ? err.name : 'error', message)
      await db.query(`update core.notifications set status = 'failed', error = $2 where id = $1`, [claimed.id, message.slice(0, 500)])
      result.failed++
      if (only) {
        result.outcome = 'failed'
        result.error = message
      }
    }
  }
  return result
}
