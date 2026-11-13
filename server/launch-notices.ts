// Messages about a launch, by email (Slack comes later). A reviewer asked to approve must be told, so these are not switched off by the daily reminder's
// preference; they are limited only by the temporary recipient limit (REMINDERS_ONLY_FOR) and by placeholder addresses, and a message held back is kept
// (status 'held') and goes out if it is asked for again once the limit is lifted. Every message links to the launch in Signal Flow, which always shows
// what is current: a request that has since been answered opens on who answered it.
//
//   launch.requested        the launch owner asks the reviewers of the steps still waiting (or reopened) for their answers
//   launch.answered         a step was answered: the launch's owner hears it
//   launch.decided          the final decision was made: the owner and every step's reviewer hear it
//   launch.reopened         the brief changed after an answer: that step's reviewer is asked to confirm it
//   launch.escalated        a request has waited: alternates are asked to cover after 3 days, the owner is told after 6 (or 3 when there is no alternate)
//   launch.approver_missing a launch that was asked for has a step nobody covers: the owner is told, once a week
import { answerLabel } from '../shared/launch.mjs'
import type { Db, Env } from './db.js'
import { allLaunchIds, launchForSystem, type LaunchDetail, type LaunchStep, type Person } from './launches.js'
import type { Mailer } from './mailer.js'
import { remindersOnlyFor } from './notifications.js'

export type Deps = { db: Db; env: Env; mailer: Mailer; now?: Date }
type Launch = LaunchDetail & { createdBy: Person | null; workspaceId: string }
export type Outcome = 'sent' | 'held' | 'failed' | 'duplicate'

export const ESCALATE_ALTERNATE_DAYS = 3
export const ESCALATE_OWNER_DAYS = 6

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const baseOf = (env: Env) => (env.APP_URL || env.BETTER_AUTH_URL || '').replace(/\/$/, '')
const first = (name: string) => name.split(' ')[0] || 'there'
const dayText = (day: string | null) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)

/** The page every launch message has: a greeting, a few lines, one link to the launch, and where all of a person's reviews are. */
function compose(o: { name: string; subject: string; lines: string[]; link: string; linkText: string; allReviews: string }) {
  const text = [`Hi ${first(o.name)},`, '', ...o.lines, '', `${o.linkText}: ${o.link}`, '', `All your reviews: ${o.allReviews}`].join('\n')
  const html = [`<p>Hi ${esc(first(o.name))},</p>`, ...o.lines.map((l) => `<p>${esc(l)}</p>`), `<p><a href="${esc(o.link)}">${esc(o.linkText)}</a></p>`, `<p><small><a href="${esc(o.allReviews)}">All your reviews</a></small></p>`].join('\n')
  return { subject: o.subject, text, html }
}

/** Sends one message to one person, once. Held (kept, not sent) when the recipient limit excludes them or the address is a placeholder. */
async function deliver(
  deps: Deps,
  launch: Launch,
  n: { to: Person; kind: string; key: string; payload: Record<string, unknown>; build: (link: string, allReviews: string) => { subject: string; text: string; html: string } },
): Promise<Outcome> {
  const { db, env, mailer } = deps
  const limited = remindersOnlyFor(env)
  const hold = limited && !limited.has(n.to.email.toLowerCase()) ? 'held by the recipient limit' : /\.(example|test|invalid)$/i.test(n.to.email) ? 'placeholder address' : null
  const claimed = (
    await db.query(
      `insert into core.notifications (workspace_id, recipient_id, kind, dedupe_key, project_id, payload, status, error) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (recipient_id, dedupe_key) do update set status = excluded.status, error = excluded.error, payload = excluded.payload
         where core.notifications.status in ('failed', 'held')
       returning id`,
      [launch.workspaceId, n.to.userId, n.kind, n.key, launch.projectId, JSON.stringify({ launchId: launch.id, ...n.payload }), hold ? 'held' : 'pending', hold],
    )
  ).rows[0]
  if (!claimed) return 'duplicate'
  if (hold) return 'held'
  try {
    const base = baseOf(env)
    if (!base) throw new Error('APP_URL or BETTER_AUTH_URL is needed to build the links in the email.')
    const step = typeof n.payload.step === 'string' ? n.payload.step : Array.isArray(n.payload.steps) ? String(n.payload.steps[0] ?? '') : ''
    await mailer.send({ to: n.to.email, ...n.build(`${base}/launches/${launch.id}${step ? `?step=${step}` : ''}`, `${base}/launches`) })
    await db.query(`update core.notifications set status = 'sent', sent_at = now() where id = $1`, [claimed.id])
    return 'sent'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('launch email failed', err instanceof Error ? err.name : 'error', message)
    await db.query(`update core.notifications set status = 'failed', error = $2 where id = $1`, [claimed.id, message.slice(0, 500)])
    return 'failed'
  }
}

async function load(deps: Deps, workspaceId: string, id: string): Promise<Launch | null> {
  const launch = await launchForSystem(deps.db, workspaceId, id)
  return launch ? { ...launch, workspaceId } : null
}

const stepsText = (steps: { label: string }[]) => steps.map((s) => s.label).join(', ')

export type RequestResult = { asked: { name: string; steps: string[] }[]; alreadyAsked: { name: string; steps: string[] }[]; held: { name: string; steps: string[] }[]; missing: { step: string; label: string }[] }

/** The launch owner asks, for each reviewer, the steps still waiting (or reopened). Asking again for the same brief sends nothing more. */
export async function requestAnswers(deps: Deps, workspaceId: string, launchId: string): Promise<RequestResult | null> {
  const launch = await load(deps, workspaceId, launchId)
  if (!launch) return null
  const wanted = launch.steps.filter((s) => s.used && (s.state === 'waiting' || s.state === 'reopened'))
  const byPerson = new Map<string, { person: Person; steps: LaunchStep[] }>()
  for (const s of wanted) {
    for (const p of s.reviewers.primary) byPerson.set(p.userId, { person: p, steps: [...(byPerson.get(p.userId)?.steps ?? []), s] })
  }
  const result: RequestResult = { asked: [], alreadyAsked: [], held: [], missing: launch.steps.filter((s) => s.used && s.state === 'missing').map((s) => ({ step: s.step, label: s.label })) }
  for (const { person, steps } of byPerson.values()) {
    const keys = steps.map((s) => s.step).sort()
    const outcome = await deliver(deps, launch, {
      to: person,
      kind: 'launch.requested',
      key: `requested:${launch.id}:${launch.briefAt}:${keys.join('+')}`,
      payload: { steps: steps.map((s) => s.step), briefAt: launch.briefAt },
      build: (link, allReviews) =>
        compose({
          name: person.name,
          subject: `Signal Flow: your answer is wanted on ${launch.name}`,
          lines: [
            `Your answer is wanted on ${launch.name}: ${stepsText(steps)}.`,
            ...(launch.targetDate ? [`The target date is ${dayText(launch.targetDate)}.`] : []),
            'Open it to see what is being asked and answer in a minute.',
          ],
          link,
          linkText: 'Open the launch',
          allReviews,
        }),
    })
    const entry = { name: person.name, steps: steps.map((s) => s.label) }
    if (outcome === 'duplicate') result.alreadyAsked.push(entry)
    else if (outcome === 'held') result.held.push(entry)
    else if (outcome === 'sent') result.asked.push(entry)
  }
  return result
}

/** After a step is answered: the launch's owner hears it; after the final decision, the owner and every step's reviewer hear the decision. */
export async function noticeAnswered(deps: Deps, workspaceId: string, launchId: string, step: string, byUserId: string): Promise<void> {
  const launch = await load(deps, workspaceId, launchId)
  const answered = launch?.steps.find((s) => s.step === step)
  if (!launch || !answered?.answer) return
  const answer = answered.answer
  if (step === 'final_decision') {
    const people = new Map<string, Person>()
    for (const s of launch.steps.filter((x) => x.used && x.step !== 'final_decision')) for (const p of s.reviewers.primary) people.set(p.userId, p)
    if (launch.createdBy) people.set(launch.createdBy.userId, launch.createdBy)
    for (const p of people.values()) {
      if (p.userId === byUserId) continue
      await deliver(deps, launch, {
        to: p,
        kind: 'launch.decided',
        key: `decided:${answer.id}`,
        payload: { step, answerId: answer.id },
        build: (link, allReviews) =>
          compose({
            name: p.name,
            subject: `Signal Flow: ${launch.name} is ${answerLabel(answer.answer).toLowerCase()}`,
            lines: [`The final decision on ${launch.name} is ${answerLabel(answer.answer).toLowerCase()}, recorded by ${answer.by?.name ?? 'someone'}.`, ...(answer.rationale ? [`Why: ${answer.rationale}`] : [])],
            link,
            linkText: 'See the record',
            allReviews,
          }),
      })
    }
    return
  }
  if (launch.createdBy && launch.createdBy.userId !== byUserId) {
    await deliver(deps, launch, {
      to: launch.createdBy,
      kind: 'launch.answered',
      key: `answered:${answer.id}`,
      payload: { step, answerId: answer.id },
      build: (link, allReviews) =>
        compose({
          name: launch.createdBy!.name,
          subject: `Signal Flow: ${answered.label} on ${launch.name}: ${answerLabel(answer.answer).toLowerCase()}`,
          lines: [`${answer.by?.name ?? 'Someone'} answered ${answered.label} on ${launch.name}: ${answerLabel(answer.answer).toLowerCase()}.`, ...(answer.rationale ? [`Why: ${answer.rationale}`] : [])],
          link,
          linkText: 'Open the launch',
          allReviews,
        }),
    })
  }
}

const isoWeek = (d: Date) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - start.getTime()) / 86400000 + 1) / 7)}`
}

export type SweepResult = { sent: number; held: number; failed: number }
const tally = (r: SweepResult, o: Outcome) => {
  if (o === 'sent') r.sent++
  else if (o === 'held') r.held++
  else if (o === 'failed') r.failed++
}

/** One launch's due messages: reopened answers, requests that have waited, a step nobody covers. Each goes once (its dedupe key says which brief and step). */
export async function sweepLaunch(deps: Deps, workspaceId: string, launchId: string, result: SweepResult = { sent: 0, held: 0, failed: 0 }): Promise<SweepResult> {
  const launch = await load(deps, workspaceId, launchId)
  if (!launch) return result
  const now = deps.now ?? new Date()
  const asked = (await deps.db.query(`select payload, created_at as at from core.notifications where kind = 'launch.requested' and payload->>'launchId' = $1`, [launch.id])).rows
  const everAsked = asked.length > 0
  const requestedAt = (step: string) => {
    const times = asked.filter((r) => r.payload?.briefAt === launch.briefAt && Array.isArray(r.payload?.steps) && r.payload.steps.includes(step)).map((r) => new Date(r.at).getTime())
    return times.length ? Math.min(...times) : null
  }
  for (const s of launch.steps.filter((x) => x.used)) {
    if (s.state === 'reopened') {
      for (const p of s.reviewers.primary) {
        tally(result, await deliver(deps, launch, {
          to: p,
          kind: 'launch.reopened',
          key: `reopened:${launch.id}:${s.step}:${launch.briefAt}`,
          payload: { step: s.step, briefAt: launch.briefAt },
          build: (link, allReviews) =>
            compose({ name: p.name, subject: `Signal Flow: please confirm your answer on ${launch.name}`, lines: [`The brief for ${launch.name} changed after you answered ${s.label}. Please confirm your answer, or answer again.`], link, linkText: 'Open the launch', allReviews }),
        }))
      }
    }
    const at = s.state === 'waiting' || s.state === 'reopened' ? requestedAt(s.step) : null
    if (at !== null) {
      const days = (now.getTime() - at) / 86400000
      if (days >= ESCALATE_ALTERNATE_DAYS && s.reviewers.alternate.length > 0) {
        for (const p of s.reviewers.alternate) {
          tally(result, await deliver(deps, launch, {
            to: p,
            kind: 'launch.escalated',
            key: `escalated-alt:${launch.id}:${s.step}:${launch.briefAt}`,
            payload: { step: s.step, briefAt: launch.briefAt },
            build: (link, allReviews) =>
              compose({ name: p.name, subject: `Signal Flow: ${s.label} on ${launch.name} is waiting. Can you cover it?`, lines: [`${s.label} on ${launch.name} has been waiting for an answer for ${Math.floor(days)} days. You are the alternate: please answer it if the primary reviewer cannot.`], link, linkText: 'Open the launch', allReviews }),
          }))
        }
      }
      if (launch.createdBy && (days >= ESCALATE_OWNER_DAYS || (days >= ESCALATE_ALTERNATE_DAYS && s.reviewers.alternate.length === 0))) {
        const to = launch.createdBy
        tally(result, await deliver(deps, launch, {
          to,
          kind: 'launch.escalated',
          key: `escalated-owner:${launch.id}:${s.step}:${launch.briefAt}`,
          payload: { step: s.step, briefAt: launch.briefAt },
          build: (link, allReviews) =>
            compose({ name: to.name, subject: `Signal Flow: ${s.label} on ${launch.name} is still waiting`, lines: [`${s.label} on ${launch.name} has been waiting for an answer for ${Math.floor(days)} days.`], link, linkText: 'Open the launch', allReviews }),
        }))
      }
    }
    if (s.state === 'missing' && everAsked && launch.createdBy) {
      const to = launch.createdBy
      tally(result, await deliver(deps, launch, {
        to,
        kind: 'launch.approver_missing',
        key: `missing:${launch.id}:${s.step}:${isoWeek(now)}`,
        payload: { step: s.step },
        build: (link, allReviews) =>
          compose({ name: to.name, subject: `Signal Flow: no reviewer for ${s.label} on ${launch.name}`, lines: [`${s.label} on ${launch.name} has no reviewer, so nobody can answer it. A workspace owner can add one under Admin, Members, Reviewers.`], link, linkText: 'Open the launch', allReviews }),
      }))
    }
  }
  return result
}

/** The hourly sweep over every launch. */
export async function sweepLaunches(deps: Deps): Promise<SweepResult> {
  const result: SweepResult = { sent: 0, held: 0, failed: 0 }
  for (const l of await allLaunchIds(deps.db)) await sweepLaunch(deps, l.workspaceId, l.id, result)
  return result
}
