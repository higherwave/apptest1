// Keeping approvers in the loop. Anyone set up as an approver for a team's launches is told, automatically and for awareness only ("nothing to answer yet"), at each
// point the release moves on: the storyboard is written (and again whenever it is rewritten after the research changes), the requirements are published, and, as
// the launch's own messages already do, when answers are asked for. Each message says where the release stands, links to the document (a PDF that opens straight
// away after sign-in), and in Slack lands in the launch's thread. Who is told is the *active* approver of each step the team uses (the primary, or the backup
// while the primary is away). An external approver is told about the requirements only: the storyboard carries customer quotes. The launch itself starts when the
// storyboard is first written, so there is one thread per release from the first message; approvals open only once the requirements are published.
import type { RequestContext } from './context.js'
import type { Db, Env, Queryable } from './db.js'
import { createLaunch, LaunchExists, launchForSystem, NoThemes, type Person } from './launches.js'
import { deliver, type Launch } from './launch-notices.js'
import { reply, startThread } from './launch-slack.js'
import type { Mailer } from './mailer.js'
import { slackText, type SlackClient } from './slack.js'

export type UpdateDeps = { db: Db; env: Env; mailer: Mailer; slack?: SlackClient }

const baseOf = (env: Env) => (env.APP_URL || env.BETTER_AUTH_URL || '').replace(/\/$/, '')
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
export const documentUrl = (env: Env, launchId: string, _kind: 'storyboard' | 'requirements') => `${baseOf(env)}/launches/${launchId}?tab=brief`
const launchUrl = (env: Env, launchId: string) => `${baseOf(env)}/launches/${launchId}`

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

async function tell(deps: UpdateDeps, launch: Launch, o: { kind: string; key: string; to: Person[]; message: Message; slack: { key: string; text: string } }): Promise<void> {
  for (const person of o.to) {
    await deliver(deps, launch, { to: person, kind: o.kind, key: o.key, payload: { updateKey: o.key }, build: () => compose(person.name, o.message) })
  }
  await reply({ db: deps.db, env: deps.env, slack: deps.slack }, launch.workspaceId, launch.id, o.kind.replace('launch.', ''), o.slack.key, o.slack.text)
}

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
    const link = documentUrl(deps.env, launchId, 'storyboard')
    const threadUrl = await threadOf(deps.db, launchId)
    const lines = [
      before ? `The storyboard for ${launch.name} was updated after the research changed.` : `The research on ${launch.name} now has a storyboard: the problem, what people said, and the directions recommended. The solutions and trade-offs are best guesses for the team to react to.`,
      'For your awareness: there is nothing to answer yet.',
      `Where this release stands: ${stageLine('storyboard')}. Approvals open once the requirements are published.`,
    ]
    await tell(deps, launch, {
      kind: 'launch.storyboard',
      key: `storyboard:${at}`,
      to: await recipients(deps.db, launch, true),
      message: { subject: `Signal Flow: ${before ? 'the storyboard was updated' : 'the storyboard is ready'} for ${launch.name}`, lines, documentLabel: 'Storyboard (PDF)', documentLink: link, launchLink: launchUrl(deps.env, launchId), threadUrl },
      slack: {
        key: `storyboard:${at}`,
        text: `:newspaper: ${before ? 'The storyboard was updated' : 'The storyboard is ready'}: <${link}|Storyboard (PDF)>. For your awareness, nothing to answer yet.\nWhere this release stands: ${slackText(stageLine('storyboard'))}. Approvals open once the requirements are published. Questions or concerns? Reply here.`,
      },
    })
  } catch (err) {
    console.error('launch update (storyboard) failed', err instanceof Error ? err.message : err)
  }
}

/** The requirements were published. Tells every active approver (external approvers too: the requirements are theirs to read). Never throws. */
export async function afterRequirements(deps: UpdateDeps, ctx: RequestContext, projectId: string): Promise<void> {
  try {
    const published = (await deps.db.query(`select published_at from delivery.specs where project_id = $1 and status = 'published' order by published_at desc limit 1`, [projectId])).rows[0]
    if (!published) return
    const launchId = await ensureLaunch(deps, ctx, projectId)
    if (!launchId) return
    const found = await launchForSystem(deps.db, ctx.workspaceId, launchId)
    if (!found) return
    const launch: Launch = { ...found, workspaceId: ctx.workspaceId }
    const at = new Date(published.published_at).toISOString()
    const link = documentUrl(deps.env, launchId, 'requirements')
    const threadUrl = await threadOf(deps.db, launchId)
    const lines = [
      `The requirements for ${launch.name} are published: the brief, and what the team will build.`,
      'For your awareness: there is nothing to answer yet. When the launch is ready for approval, you will be asked for your answer.',
      `Where this release stands: ${stageLine('requirements')}.`,
    ]
    await tell(deps, launch, {
      kind: 'launch.requirements',
      key: `requirements:${at}`,
      to: await recipients(deps.db, launch, false),
      message: { subject: `Signal Flow: the requirements are published for ${launch.name}`, lines, documentLabel: 'Requirements (PDF)', documentLink: link, launchLink: launchUrl(deps.env, launchId), threadUrl },
      slack: {
        key: `requirements:${at}`,
        text: `:memo: The requirements are published: <${link}|Requirements (PDF)>. For your awareness, nothing to answer yet.\nWhere this release stands: ${slackText(stageLine('requirements'))}. Questions or concerns? Reply here.`,
      },
    })
  } catch (err) {
    console.error('launch update (requirements) failed', err instanceof Error ? err.message : err)
  }
}
