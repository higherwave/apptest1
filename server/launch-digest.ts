// Following a launch from the research stage (slice 6). People follow a launch (functions that will have to answer later: sales, legal, documentation,
// marketing) and the launch's editor shares an early digest with them: what the research found (where people struggled, what they need, a few quotes
// as said) and the plain-language brief, with the prompt "Does everyone understand? Any concerns?". It goes by email to the followers and, if the team
// has a channel, as a reply in the launch's Slack thread, so the conversation starts there. Written from a template out of the project's own data; nothing
// is rewritten by a model. Following gives the digest and brief only: a follower is not let into the research, and a quote is never tied to a person.
import type { Db, Env, Queryable } from './db.js'
import type { RequestContext } from './context.js'
import { followersOf, launchForSystem, type Person } from './launches.js'
import { deliver, type Deps } from './launch-notices.js'
import { reply } from './launch-slack.js'
import { slackText } from './slack.js'
import { listThemes } from './themes.js'
import { getSpec } from './specs.js'
import type { SlackClient } from './slack.js'
import type { Mailer } from './mailer.js'

export class NotAFollowable extends Error {}

export const DIGEST_PROMPT = 'Does everyone understand? Any concerns? Say so in the Slack thread, or reply to whoever sent this.'
const MAX_THEMES = 5
const MAX_QUOTE = 280
const LABEL: Record<string, string> = { pain_point: 'Where people struggled', need: 'What people need', expectation: 'What people expect', delight: 'What people liked' }
const ORDER = ['pain_point', 'need', 'expectation', 'delight']

export type Digest = {
  subject: string
  text: string
  /** The same digest as Slack markup. */
  slack: string
  themeCount: number
  shown: number
  hasBrief: boolean
}

const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null)

/** The digest for a launch as the project's data stands now, or null when there is no launch. */
export async function buildDigest(db: Queryable, workspaceId: string, launchId: string): Promise<Digest | null> {
  const launch = await launchForSystem(db, workspaceId, launchId, { withBrief: true })
  if (!launch) return null
  const all = await listThemes(db, launch.projectId, { quotes: true })
  const ranked = [...all].sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category))
  const shown = ranked.slice(0, MAX_THEMES)
  const quoteOf = (t: (typeof all)[number]) => (t.quotes ?? []).find((q) => q.source === 'customer' && q.text.length <= MAX_QUOTE)?.text ?? null
  const spec = launch.brief.published ? launch.brief : null
  const facts = [launch.teamName, launch.targetDate ? `target ${day(launch.targetDate)}` : null].filter(Boolean).join(' · ')

  const themeLines = (esc: (s: string) => string, bold: (s: string) => string) =>
    shown.flatMap((t, i) => {
      const people = t.totalParticipants > 0 ? `${t.participantCount} of ${t.totalParticipants} people` : null
      const quote = quoteOf(t)
      return [
        `${i + 1}. ${bold(esc(t.title))} (${[LABEL[t.category]?.toLowerCase() ?? t.category, people].filter(Boolean).join(' · ')})`,
        ...(t.description ? [`   ${esc(t.description)}`] : []),
        ...(quote ? [`   “${esc(quote)}” (one participant)`] : []),
      ]
    })
  const briefLines = (esc: (s: string) => string, bold: (s: string) => string) =>
    spec
      ? [
          ...(spec.problem ? [`${bold('The problem')}: ${esc(spec.problem)}`] : []),
          ...(spec.users ? [`${bold('Who it is for')}: ${esc(spec.users)}`] : []),
          ...(spec.goals?.length ? [bold('Goals'), ...spec.goals.map((g) => `• ${esc(g)}`)] : []),
          `${spec.requirements.length} requirements are written.`,
        ]
      : ['The requirements are not published yet, so there is no brief to read. This digest is what the research found so far.']

  const plain = (s: string) => s
  const none = (s: string) => s
  const text = [
    `What we are learning: ${launch.name}`,
    ...(facts ? [facts] : []),
    '',
    `What the research found${all.length > shown.length ? ` (the ${shown.length} that matter most, of ${all.length})` : ''}:`,
    ...themeLines(plain, none),
    '',
    'The brief, in plain words:',
    ...briefLines(plain, none),
    '',
    DIGEST_PROMPT,
  ].join('\n')
  const bold = (s: string) => `*${s}*`
  const slack = [
    `:mag: *What we are learning: ${slackText(launch.name)}*`,
    ...(facts ? [slackText(facts)] : []),
    '',
    `*What the research found*${all.length > shown.length ? ` (the ${shown.length} that matter most, of ${all.length})` : ''}`,
    ...themeLines(slackText, bold),
    '',
    '*The brief, in plain words*',
    ...briefLines(slackText, bold),
    '',
    `:speech_balloon: ${DIGEST_PROMPT}`,
  ].join('\n')
  return { subject: `Signal Flow: what we are learning on ${launch.name}`, text, slack, themeCount: all.length, shown: shown.length, hasBrief: !!spec }
}

// ---- followers (the readers are in launches.ts, because a launch carries them) ----

const audit = (tx: Queryable, ctx: RequestContext, id: string, verb: string, after: unknown) =>
  tx.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, before, after) values ($1, $2, 'delivery.launches', $3, $4, null, $5)`, [ctx.workspaceId, ctx.userId, id, verb, JSON.stringify(after)])

/** Adds people (internal members of the workspace) as followers; ones already following are left. */
export async function addFollowers(db: Db, ctx: RequestContext, launchId: string, userIds: string[]): Promise<void> {
  await db.transaction(async (tx) => {
    const ok = (await tx.query(`select u.id, u.display_name from core.memberships m join core.users u on u.id = m.user_id where m.workspace_id = $1 and not m.is_external and u.id = any($2::uuid[])`, [ctx.workspaceId, userIds])).rows
    if (ok.length !== new Set(userIds).size) throw new NotAFollowable()
    for (const u of ok) {
      const made = await tx.query(`insert into delivery.launch_followers (launch_id, user_id, added_by) values ($1, $2, $3) on conflict do nothing returning user_id`, [launchId, u.id, ctx.userId])
      if (made.rows[0]) await audit(tx, ctx, launchId, 'follower_added', { follower: u.display_name })
    }
  })
}

export async function removeFollower(db: Db, ctx: RequestContext, launchId: string, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const gone = await tx.query(`delete from delivery.launch_followers f using core.users u where f.launch_id = $1 and f.user_id = $2 and u.id = f.user_id returning u.display_name`, [launchId, userId])
    if (gone.rows[0]) await audit(tx, ctx, launchId, 'follower_removed', { follower: gone.rows[0].display_name })
  })
}

// ---- sharing ----

export type ShareResult = { shareId: string; emailed: number; held: number; failed: number; slack: 'posted' | 'not_posted' | 'off' | 'skipped'; followers: number }
type ShareDeps = { db: Db; env: Env; mailer: Mailer; slack?: SlackClient }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const first = (name: string) => name.split(' ')[0] || 'there'

/** Shares the digest as it stands now: by email to every follower (once each), and/or as a reply in the launch's Slack thread. The record keeps what was sent. */
export async function shareDigest(deps: ShareDeps, ctx: RequestContext, launchId: string, via: { email: boolean; slack: boolean }): Promise<ShareResult | null> {
  const { db } = deps
  const launch = await launchForSystem(db, ctx.workspaceId, launchId)
  const digest = launch ? await buildDigest(db, ctx.workspaceId, launchId) : null
  if (!launch || !digest) return null
  const followers = via.email ? await followersOf(db, launchId) : []
  const sharer = (await db.query(`select display_name from core.users where id = $1`, [ctx.userId])).rows[0]?.display_name ?? 'someone'
  const id = (
    await db.query(`insert into delivery.launch_digests (launch_id, shared_by, body) values ($1, $2, $3) returning id`, [launchId, ctx.userId, digest.text])
  ).rows[0].id as string
  const result: ShareResult = { shareId: id, emailed: 0, held: 0, failed: 0, slack: 'skipped', followers: followers.length }
  const emailDeps: Deps = { db, env: deps.env, mailer: deps.mailer, slack: deps.slack }
  if (via.email) {
    const people = (await db.query(`select u.id, u.display_name, u.email from core.users u where u.id = any($1::uuid[])`, [followers.map((f) => f.userId)])).rows.map((r): Person => ({ userId: r.id, name: r.display_name, email: r.email }))
    for (const to of people) {
      const outcome = await deliver(emailDeps, { ...launch, workspaceId: ctx.workspaceId }, {
        to,
        kind: 'launch.digest',
        key: `digest:${id}`,
        payload: { digestId: id },
        build: () => ({
          subject: digest.subject,
          text: [`Hi ${first(to.name)},`, '', `${sharer} is sharing an early look at ${launch.name}, which you follow.`, '', digest.text, '', `You are getting this because you follow ${launch.name}. Ask ${sharer} if you would rather not.`].join('\n'),
          html: [`<p>Hi ${esc(first(to.name))},</p>`, `<p>${esc(sharer)} is sharing an early look at ${esc(launch.name)}, which you follow.</p>`, ...digest.text.split('\n\n').map((b) => `<p>${esc(b).replace(/\n/g, '<br>')}</p>`), `<p><small>You are getting this because you follow ${esc(launch.name)}. Ask ${esc(sharer)} if you would rather not.</small></p>`].join('\n'),
        }),
      })
      if (outcome === 'sent') result.emailed++
      else if (outcome === 'held') result.held++
      else if (outcome === 'failed') result.failed++
    }
  }
  if (via.slack) {
    if (!deps.slack?.live) result.slack = 'off'
    else result.slack = (await reply({ db, env: deps.env, slack: deps.slack }, ctx.workspaceId, launchId, 'digest', `digest:${id}`, digest.slack)) ? 'posted' : 'not_posted'
  }
  await db.query(`update delivery.launch_digests set emailed = $2, in_slack = $3 where id = $1`, [id, result.emailed, result.slack === 'posted'])
  await audit(db, ctx, launchId, 'digest_shared', { emailed: result.emailed, held: result.held, slack: result.slack })
  return result
}
