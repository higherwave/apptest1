// Messages about a launch, by email, and the same events as replies in the launch's Slack thread (server/launch-slack.ts). An approver asked to approve must be told, so these are not switched off by the daily reminder's
// preference; they are limited only by the temporary recipient limit (REMINDERS_ONLY_FOR) and by placeholder addresses, and a message held back is kept
// (status 'held') and goes out if it is asked for again once the limit is lifted. Every message links to the launch in Signal Flow, which always shows
// what is current: a request that has since been answered opens on who answered it.
//
//   launch.requested        the launch owner asks the approvers of the steps still waiting (or reopened) for their answers
//   launch.answered         a step was answered: the launch's owner hears it
//   launch.decided          the final decision was made: the owner and every step's approver hear it
//   launch.reopened         the brief changed after an answer: that step's approver is asked to confirm it
//   launch.escalated        a request has waited: backups are asked to cover after 3 days, the owner is told after 6 (or 3 when there is no backup)
//   launch.approver_missing a launch that was asked for has a step nobody covers: the owner is told, once a week
//   launch.readings_due     30, 60 or 90 days after the final go: the launch's owner is asked to record what the measures show (skipped when a reading was recorded since the last point)
import { baseUrlFor } from './workspace-urls.js'
import { answerLabel } from '../shared/launch.mjs'
import type { Db, Env } from './db.js'
import { allLaunchIds, launchForSystem, type LaunchDetail, type LaunchStep, type Person } from './launches.js'
import type { Mailer } from './mailer.js'
import { remindersOnlyFor } from './notifications.js'
import { launchSuccess } from './launch-success.js'
import { linkCard, reply, settleCards, slackLines, upsertMessage } from './launch-slack.js'
import { slackText, type SlackClient } from './slack.js'
import { T } from '../shared/terms.mjs'

export type Deps = { db: Db; env: Env; mailer: Mailer; slack?: SlackClient; now?: Date; /** The Slack client of one workspace, for a sweep across all of them. */ slackFor?: (workspaceId: string) => Promise<SlackClient | undefined> }
const slackOf = (d: Deps) => ({ db: d.db, env: d.env, slack: d.slack })
export type Launch = LaunchDetail & { createdBy: Person | null; workspaceId: string }

const DONE = ['ready', 'ready_with_conditions', 'not_applicable']
/** The steps before the final decision that the team uses. */
const gatesOf = (l: LaunchDetail) => l.steps.filter((s) => s.used && s.step !== 'final_decision')
/** Every step before the final decision is answered with a go, and the final decision is still open: the moment for sign-off. */
export const readyForSignoff = (l: LaunchDetail) => {
  const final = l.steps.find((s) => s.step === 'final_decision')
  return !!final?.used && (final.state === 'waiting' || final.state === 'reopened') && gatesOf(l).every((s) => DONE.includes(s.state))
}
/** How many conditions come with a sign-off: each step answered "ready with conditions", plus the final decision's own when it is "go with conditions". */
export const conditionsOf = (l: LaunchDetail) => gatesOf(l).filter((s) => s.state === 'ready_with_conditions').length + (l.summary.state === 'go_with_conditions' ? 1 : 0)
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`
/** The headline of the final decision, in words: Signed off, Signed off with 2 conditions, or Not signed off. */
export function signoffHeadline(l: LaunchDetail): string {
  if (l.summary.state === 'no_go') return 'Not signed off'
  const n = conditionsOf(l)
  return n > 0 ? `Signed off with ${plural(n, 'condition', 'conditions')}` : 'Signed off'
}

/** Where it stands, as one line for the thread's running status message. */
function standingLine(l: LaunchDetail, reopened = false): string {
  if (reopened) return 'Requirements reopened for changes. Answers resume when they are published again.'
  const gates = gatesOf(l)
  const answered = gates.filter((s) => DONE.includes(s.state)).length
  const final = l.summary.state
  if (final === 'go' || final === 'go_with_conditions' || final === 'no_go') return signoffHeadline(l)
  if (readyForSignoff(l)) return `All ${gates.length} steps are answered. Ready for the final decision.`
  const waiting = gates.filter((s) => ['waiting', 'reopened', 'missing'].includes(s.state)).map((s) => s.label)
  const changes = gates.filter((s) => s.state === 'changes_needed').map((s) => s.label)
  return [`${answered} of ${gates.length} steps answered`, waiting.length ? `waiting on ${waiting.join(', ')}` : '', changes.length ? `changes needed: ${changes.join(', ')}` : ''].filter(Boolean).join(' · ')
}

/** The one running status message in the launch's thread, edited as answers come in. Never throws. */
export async function refreshStatus(deps: Deps, workspaceId: string, launch: Launch): Promise<void> {
  if (!deps.slack?.live) return
  const base = await baseUrlFor(deps.db, deps.env, workspaceId)
  if (!base) return
  const reopened = launch.stage === 'storyboard' && !!(await deps.db.query(`select 1 from delivery.launches where id = $1 and asked_at is not null`, [launch.id])).rows[0]
  const card = linkCard({ title: ':bar_chart: Where it stands', line: slackText(standingLine(launch, reopened)), url: `${base}/launches/${launch.id}`, button: 'Open the launch' })
  await upsertMessage(slackOf(deps), workspaceId, launch.id, 'status', 'status', card)
}
export type Outcome = 'sent' | 'held' | 'failed' | 'duplicate'

export const ESCALATE_ALTERNATE_DAYS = 3
export const ESCALATE_OWNER_DAYS = 6

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const first = (name: string) => name.split(' ')[0] || 'there'
const dayText = (day: string | null) => (day ? new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)

/** The page every launch message has: a greeting, a few lines, one link to the launch, and where all of a person's approvals are. */
function compose(o: { name: string; subject: string; lines: string[]; link: string; linkText: string; allReviews: string }) {
  const text = [`Hi ${first(o.name)},`, '', ...o.lines, '', `${o.linkText}: ${o.link}`, '', `All your ${T.approvals}: ${o.allReviews}`].join('\n')
  const html = [`<p>Hi ${esc(first(o.name))},</p>`, ...o.lines.map((l) => `<p>${esc(l)}</p>`), `<p><a href="${esc(o.link)}">${esc(o.linkText)}</a></p>`, `<p><small><a href="${esc(o.allReviews)}">All your ${T.approvals}</a></small></p>`].join('\n')
  return { subject: o.subject, text, html }
}

/** Why a message to this address is kept rather than sent (the temporary recipient limit, a placeholder address), or null when it may go. */
function holdReason(env: Env, email: string): string | null {
  const limited = remindersOnlyFor(env)
  return limited && !limited.has(email.toLowerCase()) ? 'held by the recipient limit' : /\.(example|test|invalid)$/i.test(email) ? 'placeholder address' : null
}

/**
 * An approver was marked away: each backup who now covers their steps is told, once per change. There is no launch to link to, so the message links to
 * the person's approvals. Same rules as every launch email (held, never dropped; a failure is logged and never fails the change).
 */
export async function tellAlternatesCover(deps: Deps, workspaceId: string, away: { name: string }, alternates: { person: Person; steps: string[] }[], at: Date = new Date()): Promise<Outcome[]> {
  const out: Outcome[] = []
  for (const alt of alternates) {
    const key = `away:${alt.person.userId}:${at.toISOString()}`
    const hold = holdReason(deps.env, alt.person.email)
    try {
      const claimed = (
        await deps.db.query(
          `insert into core.notifications (workspace_id, recipient_id, kind, dedupe_key, project_id, payload, status, error) values ($1, $2, 'launch.reviewer_away', $3, null, $4, $5, $6)
           on conflict (recipient_id, dedupe_key) do nothing returning id`,
          [workspaceId, alt.person.userId, key, JSON.stringify({ away: away.name, steps: alt.steps }), hold ? 'held' : 'pending', hold],
        )
      ).rows[0]
      if (!claimed) { out.push('duplicate'); continue }
      if (hold) { out.push('held'); continue }
      const base = await baseUrlFor(deps.db, deps.env, workspaceId)
      if (!base) throw new Error('APP_URL or BETTER_AUTH_URL is needed to build the links in the email.')
      const m = compose({
        name: alt.person.name,
        subject: `Signal Flow: you are covering launch ${T.approvals} for ${away.name}`,
        lines: [`${away.name} is away, so you are now the ${T.approver} for: ${alt.steps.join(', ')}.`, 'You will get the launch messages and answer requests for these steps until they are back.'],
        link: `${base}/launches`,
        linkText: `Open your ${T.approvals}`,
        allReviews: `${base}/launches`,
      })
      await deps.mailer.send({ to: alt.person.email, ...m })
      await deps.db.query(`update core.notifications set status = 'sent', sent_at = now() where id = $1`, [claimed.id])
      out.push('sent')
    } catch (err) {
      console.error('launch email failed', err instanceof Error ? err.name : 'error', err instanceof Error ? err.message : err)
      out.push('failed')
    }
  }
  return out
}

/** Sends one message to one person, once. Held (kept, not sent) when the recipient limit excludes them or the address is a placeholder. */
export async function deliver(
  deps: Deps,
  launch: Launch,
  n: { to: Person; kind: string; key: string; payload: Record<string, unknown>; build: (link: string, allReviews: string) => { subject: string; text: string; html: string } },
): Promise<Outcome> {
  const { db, env, mailer } = deps
  const hold = holdReason(env, n.to.email)
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
    const base = await baseUrlFor(db, env, launch.workspaceId)
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

/** The launch owner asks, for each approver, the steps still waiting (or reopened). Asking again for the same brief sends nothing more. */
export async function requestAnswers(deps: Deps, workspaceId: string, launchId: string): Promise<RequestResult | null> {
  const launch = await load(deps, workspaceId, launchId)
  if (!launch) return null
  const wanted = launch.steps.filter((s) => s.used && (s.state === 'waiting' || s.state === 'reopened'))
  const byPerson = new Map<string, { person: Person; steps: LaunchStep[] }>()
  for (const s of wanted) {
    for (const p of s.reviewers.active) byPerson.set(p.userId, { person: p, steps: [...(byPerson.get(p.userId)?.steps ?? []), s] })
  }
  await deps.db.query(`update delivery.launches set asked_at = coalesce(asked_at, now()) where id = $1`, [launchId])
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
  // In Slack the ask is the running status message (one message, edited), not a post per person and a card per step.
  const fresh = await load(deps, workspaceId, launchId)
  if (fresh) await refreshStatus(deps, workspaceId, fresh)
  return result
}

/** After a step is answered: the launch's owner hears it; after the final decision, the owner and every step's approver hear the decision. */
export async function noticeAnswered(deps: Deps, workspaceId: string, launchId: string, step: string, byUserId: string): Promise<void> {
  const launch = await load(deps, workspaceId, launchId)
  const answered = launch?.steps.find((s) => s.step === step)
  if (!launch || !answered?.answer) return
  const answer = answered.answer
  await settleCards(slackOf(deps), launchId, step, `:white_check_mark: *${answered.label}*: ${answerLabel(answer.answer).toLowerCase()}, by ${slackText(answer.by?.name ?? 'someone')}.`) // cards posted before answers moved to the app
  const base = await baseUrlFor(deps.db, deps.env, workspaceId)
  const record = base ? `${base}/launches/${launchId}` : null
  if (step === 'final_decision') await reply(slackOf(deps), workspaceId, launchId, 'decided', `answered:${answer.id}`, slackLines.decided(signoffHeadline(launch), answer.by?.name ?? 'someone', answer.rationale, record))
  await refreshStatus(deps, workspaceId, launch)
  if (step === 'final_decision') {
    // The sign-off is told to the whole team (not only the approvers), with a link back to the launch for the record.
    const people = new Map<string, Person>()
    for (const s of launch.steps.filter((x) => x.used && x.step !== 'final_decision')) for (const p of s.reviewers.active) people.set(p.userId, p)
    if (launch.createdBy) people.set(launch.createdBy.userId, launch.createdBy)
    if (launch.teamId) {
      const team = await deps.db.query(`select u.id, u.display_name, u.email from core.team_memberships tm join core.users u on u.id = tm.user_id where tm.team_id = $1`, [launch.teamId])
      for (const r of team.rows) people.set(r.id as string, { userId: r.id as string, name: r.display_name as string, email: r.email as string })
    }
    const headline = signoffHeadline(launch)
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
            subject: `Signal Flow: ${launch.name}: ${headline.toLowerCase()}`,
            lines: [`${headline}: ${launch.name}.`, `Recorded by ${answer.by?.name ?? 'someone'}.`, ...(answer.rationale ? [`Why: ${answer.rationale}`] : [])],
            link,
            linkText: 'See the record',
            allReviews,
          }),
      })
    }
    return
  }
  // Every step before the final decision is answered with a go: the final approver is told it is theirs, once for this version of the brief.
  if (readyForSignoff(launch)) {
    const final = launch.steps.find((x) => x.step === 'final_decision')!
    for (const p of final.reviewers.active) {
      await deliver(deps, launch, {
        to: p,
        kind: 'launch.ready_for_signoff',
        key: `signoff:${launch.id}:${launch.briefAt}`,
        payload: { step: 'final_decision', briefAt: launch.briefAt },
        build: (link, allReviews) =>
          compose({
            name: p.name,
            subject: `Signal Flow: ${launch.name} is ready for your sign-off`,
            lines: [`Every step on ${launch.name} has been answered${conditionsOf(launch) > 0 ? `, with ${plural(conditionsOf(launch), 'condition', 'conditions')}` : ''}. The final decision is yours.`],
            link,
            linkText: 'Open the launch',
            allReviews,
          }),
      })
    }
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

/** A look is only worth a message while it is fresh: a measure set up long after the point passed is not chased for it. */
export const READINGS_WINDOW_DAYS = 14

/**
 * 30, 60 and 90 days after the final go, the launch's owner is asked, once per point, to record what the measures show. Only the latest point that has come due, and only
 * when no reading has been recorded since the point before it (the first point counts from the approval). Nothing is sent for a launch with no measures. The message links to
 * the launch's "How will we know it worked?" tab, where the readings are recorded.
 */
async function remindReadings(deps: Deps, launch: Launch, now: Date, result: SweepResult): Promise<void> {
  if (!launch.createdBy) return
  const s = await launchSuccess(deps.db, launch.workspaceId, launch.id)
  if (!s || !s.locked || !s.approvedOn || s.measures.length === 0) return
  const day = now.toISOString().slice(0, 10)
  const due = s.reviewPoints.filter((p) => p.on && p.on <= day)
  const point = due[due.length - 1]
  if (!point || !point.on) return
  if ((now.getTime() - new Date(`${point.on}T00:00:00Z`).getTime()) / 86400000 > READINGS_WINDOW_DAYS) return
  const previous = due.length > 1 ? due[due.length - 2].on! : s.approvedOn
  if (s.measures.some((m) => m.checkins.some((c) => c.on >= previous))) return
  const to = launch.createdBy
  const count = s.measures.length
  tally(result, await deliver(deps, launch, {
    to,
    kind: 'launch.readings_due',
    key: `readings:${launch.id}:${point.key}`,
    payload: { point: point.key },
    build: (link, allReviews) =>
      compose({
        name: to.name,
        subject: `Signal Flow: time for the ${point.label} look at ${launch.name}`,
        lines: [`${launch.name} was signed off ${point.days} days ago. ${plural(count, 'measure is', 'measures are')} waiting for a reading.`, 'Record what you are seeing, even if it is early: a "too early to tell" is a useful answer.'],
        link: `${link.split('?')[0]}?tab=success`,
        linkText: 'Record the readings',
        allReviews,
      }),
  }))
}

/** One launch's due messages: reopened answers, requests that have waited, a step nobody covers. Each goes once (its dedupe key says which brief and step). */
export async function sweepLaunch(deps: Deps, workspaceId: string, launchId: string, result: SweepResult = { sent: 0, held: 0, failed: 0 }): Promise<SweepResult> {
  const launch = await load(deps, workspaceId, launchId)
  if (!launch) return result
  if (launch.stage === 'storyboard') return result // the requirements are not published (never, or returned to draft): nobody is asked or chased until they are
  const now = deps.now ?? new Date()
  const asked = (await deps.db.query(`select payload, created_at as at from core.notifications where kind = 'launch.requested' and payload->>'launchId' = $1`, [launch.id])).rows
  const everAsked = asked.length > 0
  const requestedAt = (step: string) => {
    const times = asked.filter((r) => r.payload?.briefAt === launch.briefAt && Array.isArray(r.payload?.steps) && r.payload.steps.includes(step)).map((r) => new Date(r.at).getTime())
    return times.length ? Math.min(...times) : null
  }
  for (const s of launch.steps.filter((x) => x.used)) {
    if (s.state === 'reopened') {
      await reply(slackOf(deps), workspaceId, launchId, 'reopened', `reopened:${s.step}:${launch.briefAt}`, slackLines.reopened(s.label))
      await refreshStatus(deps, workspaceId, launch)
      for (const p of s.reviewers.active) {
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
              compose({ name: p.name, subject: `Signal Flow: ${s.label} on ${launch.name} is waiting. Can you cover it?`, lines: [`${s.label} on ${launch.name} has been waiting for an answer for ${Math.floor(days)} days. You are the ${T.backup}: please answer it if the ${T.approver} cannot.`], link, linkText: 'Open the launch', allReviews }),
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
          compose({ name: to.name, subject: `Signal Flow: no ${T.approver} for ${s.label} on ${launch.name}`, lines: [`${s.label} on ${launch.name} has no ${T.approver}, so nobody can answer it. A workspace owner can add one under Settings, ${T.Approvals}.`], link, linkText: 'Open the launch', allReviews }),
      }))
    }
  }
  await remindReadings(deps, launch, now, result)
  return result
}

/** The hourly sweep over every launch. */
export async function sweepLaunches(deps: Deps): Promise<SweepResult> {
  const result: SweepResult = { sent: 0, held: 0, failed: 0 }
  for (const l of await allLaunchIds(deps.db)) await sweepLaunch({ ...deps, slack: (await deps.slackFor?.(l.workspaceId)) ?? deps.slack }, l.workspaceId, l.id, result)
  return result
}
