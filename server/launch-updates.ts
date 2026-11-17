// Keeping approvers in the loop. Anyone set up as an approver for a team's launches is told, automatically and for awareness only ("nothing to answer yet"), at each
// point the release moves on: the storyboard is written (and again whenever it is rewritten after the research changes), the requirements are published, and, as
// the launch's own messages already do, when answers are asked for. Each message says where the release stands, links to the document (a PDF that opens straight
// away after sign-in), and in Slack lands in the launch's thread. Who is told is the *active* approver of each step the team uses (the primary, or the backup
// while the primary is away). An external approver is told about the requirements only: the storyboard carries customer quotes. The launch itself starts when the
// storyboard is first written, so there is one thread per release from the first message; approvals open only once the requirements are published.
import { baseUrlFor } from './workspace-urls.js'
import type { RequestContext } from './context.js'
import type { Db, Env, Queryable } from './db.js'
import { createLaunch, LaunchExists, launchForSystem, NoThemes, type Person } from './launches.js'
import { deliver, refreshStatus, requestAnswers, type Launch } from './launch-notices.js'
import { linkCard, startThread, upsertMessage, type LinkCard } from './launch-slack.js'
import type { Mailer } from './mailer.js'
import { slackText, type SlackClient } from './slack.js'
import { T } from '../shared/terms.mjs'

export type UpdateDeps = { db: Db; env: Env; mailer: Mailer; slack?: SlackClient }

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const first = (name: string) => name.split(' ')[0] || 'there'

export type Stage = 'storyboard' | 'requirements' | 'approval'
const STAGES: { key: Stage; label: string }[] = [
  { key: 'storyboard', label: 'Storyboard' },
  { key: 'requirements', label: 'Requirements' },
  { key: 'approval', label: 'Ready for approval' },
]
/** "Storyboard (you are here) > Requirements > Ready for approval": the orientation line in every message. */
export const stageLine = (now: Stage) => STAGES.map((s) => (s.key === now ? `${s.label} (now)` : s.label)).join(' > ')

/** Where a message about a document points: the launch's Product Brief tab, whose Docs panel opens it (the app signs the person in first). */
export const documentUrl = (base: string, launchId: string, _kind: 'storyboard' | 'requirements') => `${base}/launches/${launchId}?tab=brief`
const launchUrl = (base: string, launchId: string) => `${base}/launches/${launchId}`

/**
 * The launch of a project, made if it has none (the storyboard was just written, so there are themes). Its thread opens in the team's Slack channel. Null when
 * there is nothing to start (no themes). The person who ran the analysis is its owner.
 */
export async function ensureLaunch(deps: UpdateDeps, ctx: RequestContext, projectId: string): Promise<string | null> {
  try {
    const id = await createLaunch(deps.db, ctx, projectId, {})
    await startThread({ db: deps.db, env: deps.env, slack: deps.slack }, ctx.workspaceId, id).catch(() => undefined)
    return id
  } catch (err) {
    if (err instanceof LaunchExists) return ((await deps.db.query(`select id from delivery.launches where project_id = $1`, [projectId])).rows[0]?.id as string) ?? null
    if (err instanceof NoThemes) return null
    throw err
  }
}

/** The active approvers of the steps the team uses, once each. `internalOnly` leaves out external members (the storyboard is not for them). */
async function recipients(db: Queryable, launch: Launch, internalOnly: boolean): Promise<Person[]> {
  const people = new Map<string, Person>()
  for (const s of launch.steps.filter((x) => x.used)) for (const p of s.reviewers.active) people.set(p.userId, p)
  if (!people.size || !internalOnly) return [...people.values()]
  const external = new Set((await db.query(`select user_id from core.memberships where workspace_id = $1 and is_external and user_id = any($2::uuid[])`, [launch.workspaceId, [...people.keys()]])).rows.map((r) => r.user_id as string))
  return [...people.values()].filter((p) => !external.has(p.userId))
}

type Message = { subject: string; lines: string[]; documentLabel: string; documentLink: string; launchLink: string; threadUrl: string | null }

function compose(name: string, m: Message) {
  const tail = m.threadUrl ? [`Questions or concerns? Add them in the Slack thread: ${m.threadUrl}`] : ['Questions or concerns? Reply to whoever owns the launch.']
  const text = [`Hi ${first(name)},`, '', ...m.lines, '', `${m.documentLabel}: ${m.documentLink}`, `Open the launch: ${m.launchLink}`, '', ...tail].join('\n')
  const html = [
    `<p>Hi ${esc(first(name))},</p>`,
    ...m.lines.map((l) => `<p>${esc(l)}</p>`),
    `<p><a href="${esc(m.documentLink)}">${esc(m.documentLabel)}</a><br><a href="${esc(m.launchLink)}">Open the launch</a></p>`,
    `<p><small>${m.threadUrl ? `Questions or concerns? <a href="${esc(m.threadUrl)}">Add them in the Slack thread</a>.` : 'Questions or concerns? Reply to whoever owns the launch.'}</small></p>`,
  ].join('\n')
  return { subject: m.subject, text, html }
}

async function tell(deps: UpdateDeps, launch: Launch, o: { kind: string; key: string; to: Person[]; message: Message; card: LinkCard }): Promise<void> {
  for (const person of o.to) {
    await deliver(deps, launch, { to: person, kind: o.kind, key: o.key, payload: { updateKey: o.key }, build: () => compose(person.name, o.message) })
  }
  await postDocument(deps, launch, o.kind.replace('launch.', ''), o.card)
}

/** The document's one message in the thread: posted the first time, then edited in place (a rewritten storyboard does not add a message or a notification). */
const postDocument = (deps: UpdateDeps, launch: Launch, kind: 'storyboard' | 'requirements' | string, card: LinkCard) =>
  upsertMessage({ db: deps.db, env: deps.env, slack: deps.slack }, launch.workspaceId, launch.id, `doc:${kind}`, `doc:${kind}`, card)

const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

const threadOf = async (db: Queryable, launchId: string) => ((await db.query(`select slack_permalink from delivery.launches where id = $1`, [launchId])).rows[0]?.slack_permalink as string | null) ?? null

/**
 * The storyboard was written (after an analysis, or generated by hand). Starts the launch if this is the first one, then tells the active approvers once per
 * version of the storyboard (so an analysis that left the old deck in place says nothing twice). Never throws.
 */
export async function afterStoryboard(deps: UpdateDeps, ctx: RequestContext, projectId: string): Promise<void> {
  try {
    const written = (await deps.db.query(`select generated_at from research.storyboards where project_id = $1`, [projectId])).rows[0]
    if (!written) return
    const launchId = await ensureLaunch(deps, ctx, projectId)
    if (!launchId) return
    const found = await launchForSystem(deps.db, ctx.workspaceId, launchId)
    if (!found) return
    const launch: Launch = { ...found, workspaceId: ctx.workspaceId }
    const at = new Date(written.generated_at).toISOString()
    const before = (await deps.db.query(`select 1 from core.notifications where kind = 'launch.storyboard' and payload->>'launchId' = $1 limit 1`, [launchId])).rows[0]
    const base = await baseUrlFor(deps.db, deps.env, ctx.workspaceId)
    const link = documentUrl(base, launchId, 'storyboard')
    const threadUrl = await threadOf(deps.db, launchId)
    const count = ((await deps.db.query(`select count(*)::int n from research.transcripts where project_id = $1`, [projectId])).rows[0]?.n as number) ?? 0
    const sources = count > 0 ? `${count} ${count === 1 ? 'transcript' : 'transcripts'}` : ''
    const lines = [
      before ? `The storyboard for ${launch.name} was updated after the research changed.` : `The research on ${launch.name} now has a storyboard: the problem, what people said, and the directions recommended. The solutions and trade-offs are best guesses for the team to react to.`,
      'For your awareness: there is nothing to answer yet.',
      `Where this release stands: ${stageLine('storyboard')}. ${T.Approvals} open once the requirements are published.`,
    ]
    await tell(deps, launch, {
      kind: 'launch.storyboard',
      key: `storyboard:${at}`,
      to: await recipients(deps.db, launch, true),
      message: { subject: `Signal Flow: ${before ? 'the storyboard was updated' : 'the storyboard is ready'} for ${launch.name}`, lines, documentLabel: 'Storyboard (PDF)', documentLink: link, launchLink: launchUrl(base, launchId), threadUrl },
      card: linkCard({
        title: ':newspaper: Storyboard',
        line: before ? `Updated ${dateText(at)}${sources ? `, from ${sources}` : ''}. Nothing to answer yet.` : `What the research found and the directions recommended${sources ? `, from ${sources}` : ''}. Nothing to answer yet.`,
        url: link,
        button: 'Open the storyboard',
      }),
    })
  } catch (err) {
    console.error('launch update (storyboard) failed', err instanceof Error ? err.message : err)
  }
}

/**
 * The requirements were published. Their one message in the Slack thread is posted (or edited, when they were published again), and the first time they are
 * published the answers are asked for, so nobody has to press Ask: each approver is emailed what is wanted of them and the thread's status message starts.
 * A later publish only edits the message; answers the new brief reopens are asked again by the sweep. Never throws.
 */
export async function afterRequirements(deps: UpdateDeps, ctx: RequestContext, projectId: string): Promise<void> {
  try {
    const published = (await deps.db.query(`select published_at from delivery.specs where project_id = $1 and status = 'published' order by published_at desc limit 1`, [projectId])).rows[0]
    if (!published) return
    const launchId = await ensureLaunch(deps, ctx, projectId)
    if (!launchId) return
    const found = await launchForSystem(deps.db, ctx.workspaceId, launchId)
    if (!found) return
    const launch: Launch = { ...found, workspaceId: ctx.workspaceId }
    const base = await baseUrlFor(deps.db, deps.env, ctx.workspaceId)
    const link = documentUrl(base, launchId, 'requirements')
    const wanted = launch.steps.filter((s) => s.used && (s.state === 'waiting' || s.state === 'reopened') && s.reviewers.active.length > 0).map((s) => s.label)
    await postDocument(deps, launch, 'requirements', linkCard({
      title: ':memo: Requirements published',
      line: launch.stage === 'approval' ? `Updated ${dateText(new Date(published.published_at).toISOString())}.` : wanted.length ? `Needs an answer from: ${slackText(wanted.join(', '))}.` : 'Nothing to answer yet.',
      url: link,
      button: 'Open the requirements',
    }))
    if (launch.stage !== 'approval') await requestAnswers({ db: deps.db, env: deps.env, mailer: deps.mailer, slack: deps.slack }, ctx.workspaceId, launchId)
    else await refreshStatus({ db: deps.db, env: deps.env, mailer: deps.mailer, slack: deps.slack }, ctx.workspaceId, launch)
  } catch (err) {
    console.error('launch update (requirements) failed', err instanceof Error ? err.message : err)
  }
}

const plain = (name: string, lines: string[], linkText: string, link: string) => ({
  subject: '',
  text: [`Hi ${first(name)},`, '', ...lines, '', `${linkText}: ${link}`].join('\n'),
  html: [`<p>Hi ${esc(first(name))},</p>`, ...lines.map((l) => `<p>${esc(l)}</p>`), `<p><a href="${esc(link)}">${esc(linkText)}</a></p>`].join('\n'),
})

/**
 * The requirements were returned to draft by an owner or the final approver. The launch hears it once: everyone who was asked (and the launch's owner) is emailed
 * what happened and that they will be asked again after the republish; in Slack the requirements message is edited in place, and the status line follows. Never throws.
 */
export async function afterReopen(deps: UpdateDeps, ctx: RequestContext, projectId: string, reason: string): Promise<void> {
  try {
    const launchId = ((await deps.db.query(`select id from delivery.launches where project_id = $1`, [projectId])).rows[0]?.id as string | undefined) ?? null
    if (!launchId) return
    const found = await launchForSystem(deps.db, ctx.workspaceId, launchId)
    if (!found) return
    const launch: Launch = { ...found, workspaceId: ctx.workspaceId }
    const asked = !!(await deps.db.query(`select 1 from delivery.launches where id = $1 and asked_at is not null`, [launchId])).rows[0]
    const base = await baseUrlFor(deps.db, deps.env, ctx.workspaceId)
    const link = launchUrl(base, launchId)
    await postDocument(deps, launch, 'requirements', linkCard({ title: ':memo: Requirements reopened', line: 'Being revised. You will be asked again once they are published.', url: link, button: 'Open the launch' }))
    await refreshStatus({ db: deps.db, env: deps.env, mailer: deps.mailer, slack: deps.slack }, ctx.workspaceId, launch)
    if (!asked) return
    const to = new Map<string, Person>()
    for (const s of launch.steps.filter((x) => x.used)) for (const p of s.reviewers.active) to.set(p.userId, p)
    if (launch.createdBy) to.set(launch.createdBy.userId, launch.createdBy)
    const at = new Date().toISOString()
    for (const person of to.values()) {
      if (person.userId === ctx.userId) continue
      await deliver(deps, launch, {
        to: person,
        kind: 'launch.requirements_reopened',
        key: `reopened:${launchId}:${at}`,
        payload: { reopenedAt: at },
        build: () => ({
          ...plain(person.name, [`The requirements for ${launch.name} were returned to draft by ${ctx.displayName}.`, `Why: ${reason}`, 'Nothing is needed from you yet. You will be asked again, and your earlier answer will be confirmed, once they are published again.'], 'Open the launch', link),
          subject: `Signal Flow: the requirements for ${launch.name} were reopened`,
        }),
      })
    }
  } catch (err) {
    console.error('launch update (reopened) failed', err instanceof Error ? err.message : err)
  }
}

/**
 * A Jira ticket was made. The first real one (a simulated ticket pushes nothing) locks the project's requirements for good: the launch's owner is told once, and
 * the audit log records it. Never throws.
 */
export async function afterFirstTicket(deps: UpdateDeps, ctx: RequestContext, storyId: string, simulated: boolean): Promise<void> {
  try {
    if (simulated) return
    const spec = (await deps.db.query(`select s.id, s.project_id from delivery.stories st join delivery.specs s on s.id = st.spec_id where st.id = $1`, [storyId])).rows[0]
    if (!spec) return
    const count = (await deps.db.query(`select count(*)::int n from delivery.story_tickets t join delivery.specs s on s.id = t.spec_id where s.project_id = $1 and coalesce(t.simulated, false) = false`, [spec.project_id])).rows[0].n as number
    if (count !== 1) return
    await deps.db.query(`insert into core.audit_log (workspace_id, actor_id, entity, entity_id, verb, after) values ($1, $2, 'delivery.specs', $3, 'locked_permanently', $4)`, [ctx.workspaceId, ctx.userId, spec.id, JSON.stringify({ reason: 'the first Jira ticket was created' })])
    const launchId = ((await deps.db.query(`select id from delivery.launches where project_id = $1`, [spec.project_id])).rows[0]?.id as string | undefined) ?? null
    if (!launchId) return
    const found = await launchForSystem(deps.db, ctx.workspaceId, launchId)
    if (!found?.createdBy || found.createdBy.userId === ctx.userId) return
    const launch: Launch = { ...found, workspaceId: ctx.workspaceId }
    const owner = found.createdBy
    const base = await baseUrlFor(deps.db, deps.env, ctx.workspaceId)
    await deliver(deps, launch, {
      to: owner,
      kind: 'launch.requirements_locked',
      key: `locked:${spec.id}`,
      payload: { specId: spec.id },
      build: () => ({
        ...plain(owner.name, [`The first Jira ticket for ${launch.name} was created, so its requirements are now locked for good.`, 'They can no longer be returned to draft. Changes from here happen in a new project.'], 'Open the launch', launchUrl(base, launchId)),
        subject: `Signal Flow: the requirements for ${launch.name} are locked`,
      }),
    })
  } catch (err) {
    console.error('launch update (locked) failed', err instanceof Error ? err.message : err)
  }
}
