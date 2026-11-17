// A launch in Slack: one thread per launch, in the channel its team has set. The first message opens the thread (what the launch is, its target date and
// a link to it); what happens next is posted as replies: a request for answers, a step answered, the final decision, an answer the brief reopened.
// Slack carries the conversation and Signal Flow keeps the decisions, so nothing is read back from the thread and nobody approves from Slack.
// A reply goes once (its dedupe key says which event, in launch_slack_posts). A failed post never fails the action that caused it, and Slack being off
// (no token) or a team having no channel is not an error: nothing is posted. REMINDERS_ONLY_FOR limits email to one address; it does not apply here, because a
// channel post has no recipient, so use a channel only you are in while that limit is set.
import { baseUrlFor } from './workspace-urls.js'
import type { Db, Env, Queryable } from './db.js'
import { slackProblem, slackText, SlackError, type SlackBlocks, type SlackClient } from './slack.js'
import { answersFor } from '../shared/launch.mjs'
import { T } from '../shared/terms.mjs'

export type SlackDeps = { db: Db; env: Env; slack?: SlackClient }
export type ThreadResult = { state: 'started' | 'already' | 'off' | 'no_channel' | 'failed'; url: string | null; problem: string | null }


type Target = { name: string; targetDate: string | null; teamName: string | null; channel: string | null; channelId: string | null; ts: string | null; url: string | null; owner: string | null }

async function targetOf(db: Queryable, workspaceId: string, id: string): Promise<Target | null> {
  const r = (
    await db.query(
      `select l.name, to_char(l.target_date, 'Mon DD, YYYY') as target_date, t.name as team_name, t.slack_channel, l.slack_channel_id, l.slack_thread_ts, l.slack_permalink, u.display_name as owner
         from delivery.launches l join core.projects p on p.id = l.project_id left join core.teams t on t.id = p.team_id left join core.users u on u.id = l.created_by
        where l.id = $1 and l.workspace_id = $2`,
      [id, workspaceId],
    )
  ).rows[0]
  return r
    ? { name: r.name, targetDate: r.target_date, teamName: r.team_name, channel: r.slack_channel, channelId: r.slack_channel_id, ts: r.slack_thread_ts, url: r.slack_permalink, owner: r.owner }
    : null
}

/** Reserves a message so it goes once; false when it already went (or is going now). A failed one, or one stuck for five minutes, may be tried again. */
async function claim(db: Queryable, launchId: string, kind: string, key: string): Promise<string | null> {
  const row = (
    await db.query(
      `insert into delivery.launch_slack_posts (launch_id, kind, dedupe_key) values ($1, $2, $3)
       on conflict (launch_id, dedupe_key) do update set status = 'pending', error = null, created_at = now()
         where delivery.launch_slack_posts.status = 'failed' or (delivery.launch_slack_posts.status = 'pending' and delivery.launch_slack_posts.created_at < now() - interval '5 minutes')
       returning id`,
      [launchId, kind, key],
    )
  ).rows[0]
  return row ? (row.id as string) : null
}

const failure = (err: unknown) => (err instanceof SlackError ? slackProblem(err.code) : err instanceof Error ? err.message : String(err))

/** Opens the launch's thread in its team's channel, once. Used when a launch is made, when an owner asks for it, and before the first reply. */
export async function startThread(deps: SlackDeps, workspaceId: string, launchId: string): Promise<ThreadResult> {
  const { db, env, slack } = deps
  const t = await targetOf(db, workspaceId, launchId)
  if (!t) return { state: 'failed', url: null, problem: 'No such launch.' }
  if (t.ts) return { state: 'already', url: t.url, problem: null }
  if (!slack?.live) return { state: 'off', url: null, problem: 'Slack is not connected: SLACK_BOT_TOKEN is not set.' }
  if (!t.channel) return { state: 'no_channel', url: null, problem: 'This launch’s team has no Slack channel. A workspace owner sets it on the Teams page.' }
  const id = await claim(db, launchId, 'root', 'root')
  if (!id) return { state: 'already', url: t.url, problem: null }
  try {
    const channel = await slack.channelId(t.channel)
    const base = await baseUrlFor(db, env, workspaceId)
    const text = [
      `:rocket: *Launch: ${slackText(t.name)}*`,
      [t.teamName ? slackText(t.teamName) : null, t.targetDate ? `target ${t.targetDate}` : null, t.owner ? `owner ${slackText(t.owner)}` : null].filter(Boolean).join(' · '),
      base ? `<${base}/launches/${launchId}|Open the launch in Signal Flow>` : '',
      'Talk it through in this thread. Go signals are given, and recorded, in Signal Flow.',
    ].filter(Boolean).join('\n')
    const posted = await slack.post(channel, text)
    const url = await slack.permalink(posted.channel, posted.ts)
    await db.query(`update delivery.launches set slack_channel_id = $2, slack_thread_ts = $3, slack_permalink = $4 where id = $1`, [launchId, posted.channel, posted.ts, url])
    await db.query(`update delivery.launch_slack_posts set status = 'sent', ts = $2 where id = $1`, [id, posted.ts])
    return { state: 'started', url, problem: null }
  } catch (err) {
    console.error('launch slack thread failed', err instanceof Error ? err.name : 'error', failure(err))
    await db.query(`update delivery.launch_slack_posts set status = 'failed', error = $2 where id = $1`, [id, failure(err).slice(0, 500)])
    return { state: 'failed', url: null, problem: failure(err) }
  }
}

/** One reply in the launch's thread (the thread is opened first if it is not there yet). Never throws. */
export async function reply(deps: SlackDeps, workspaceId: string, launchId: string, kind: string, key: string, text: string, blocks?: SlackBlocks): Promise<boolean> {
  const { db, slack } = deps
  try {
    if (!slack?.live) return false
    let t = await targetOf(db, workspaceId, launchId)
    if (!t) return false
    if (!t.ts) {
      await startThread(deps, workspaceId, launchId)
      t = await targetOf(db, workspaceId, launchId)
      if (!t?.ts) return false
    }
    const id = await claim(db, launchId, kind, key)
    if (!id) return false
    try {
      const posted = await slack.post(t.channelId!, text, t.ts!, blocks)
      await db.query(`update delivery.launch_slack_posts set status = 'sent', ts = $2 where id = $1`, [id, posted.ts])
      return true
    } catch (err) {
      console.error('launch slack reply failed', err instanceof Error ? err.name : 'error', failure(err))
      await db.query(`update delivery.launch_slack_posts set status = 'failed', error = $2 where id = $1`, [id, failure(err).slice(0, 500)])
      return false
    }
  } catch (err) {
    console.error('launch slack failed', failure(err))
    return false
  }
}

/** A message that is one card with a link button: a title, a line, and where it leads. The text is the plain version notifications show. Callers escape title and line. */
export type LinkCard = { text: string; blocks: SlackBlocks }
export function linkCard(o: { title: string; line: string; url: string; button: string }): LinkCard {
  return {
    text: `${o.title}: ${o.line} <${o.url}|${o.button}>`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `*${o.title}*\n${o.line}` } },
      { type: 'actions', block_id: 'open', elements: [{ type: 'button', action_id: 'open', style: 'primary', text: { type: 'plain_text', text: o.button }, url: o.url }] },
    ],
  }
}

// Slack's answers that mean the message we kept is gone (deleted, or too old to change): a new one is posted in its place. Anything else (a rate limit) leaves it alone.
const GONE = new Set(['message_not_found', 'cant_update_message', 'edit_window_closed'])

/**
 * One message that is kept up to date instead of repeated: the storyboard, the requirements, the running status. The first call posts it in the thread; every
 * later call edits that same message (no new notification, no pile of old links). If the message has been deleted in Slack it is posted again. Never throws.
 */
export async function upsertMessage(deps: SlackDeps, workspaceId: string, launchId: string, kind: string, key: string, card: LinkCard): Promise<'posted' | 'updated' | 'off' | 'failed'> {
  const { db, slack } = deps
  try {
    if (!slack?.live) return 'off'
    let t = await targetOf(db, workspaceId, launchId)
    if (!t) return 'off'
    if (!t.ts) {
      await startThread(deps, workspaceId, launchId)
      t = await targetOf(db, workspaceId, launchId)
      if (!t?.ts) return 'off'
    }
    const row = (await db.query(`select id, ts, status from delivery.launch_slack_posts where launch_id = $1 and dedupe_key = $2`, [launchId, key])).rows[0]
    let id: string | null
    if (row?.status === 'sent' && row.ts) {
      try {
        await slack.updateMessage(t.channelId!, row.ts, card.text, card.blocks)
        return 'updated'
      } catch (err) {
        if (!(err instanceof SlackError && GONE.has(err.code))) {
          console.error('launch slack update failed', failure(err))
          return 'failed'
        }
      }
      await db.query(`update delivery.launch_slack_posts set status = 'pending', error = null, ts = null, created_at = now() where id = $1`, [row.id])
      id = row.id as string
    } else {
      id = await claim(db, launchId, kind, key)
    }
    if (!id) return 'off'
    try {
      const posted = await slack.post(t.channelId!, card.text, t.ts!, card.blocks)
      await db.query(`update delivery.launch_slack_posts set status = 'sent', ts = $2 where id = $1`, [id, posted.ts])
      return 'posted'
    } catch (err) {
      console.error('launch slack message failed', err instanceof Error ? err.name : 'error', failure(err))
      await db.query(`update delivery.launch_slack_posts set status = 'failed', error = $2 where id = $1`, [id, failure(err).slice(0, 500)])
      return 'failed'
    }
  } catch (err) {
    console.error('launch slack failed', failure(err))
    return 'failed'
  }
}

const reason = (why: string) => (why ? `\n> ${slackText(why).replace(/\n+/g, ' ')}` : '')

export const slackLines = {
  decided: (headline: string, by: string, why: string, url: string | null) => `:rocket: *${slackText(headline)}*, recorded by ${slackText(by)}.${reason(why)}${url ? `\n<${url}|See the record in Signal Flow>` : ''}`,
  reopened: (step: string) => `:arrows_counterclockwise: The brief changed after *${slackText(step)}* was answered. Its ${T.approver} is asked to confirm it.`,
}

// ---- approval cards: a step's answer given from Slack ----

export type CardStep = { step: string; label: string; waitingFor: string[] }

/** The card for one step: who it waits for, and a button for each answer. The click carries the launch and step; who may answer is checked when it arrives. */
export function cardBlocks(launchId: string, c: CardStep, text: string): SlackBlocks {
  return [
    { type: 'section', text: { type: 'mrkdwn', text } },
    {
      type: 'actions',
      block_id: `card:${c.step}`,
      elements: answersFor(c.step).map((a: { key: string; label: string; good: boolean }) => ({
        type: 'button',
        action_id: `answer:${a.key}`,
        value: `${launchId}|${c.step}`,
        text: { type: 'plain_text', text: a.label },
        ...(a.key === 'changes_needed' || a.key === 'no_go' ? { style: 'danger' } : {}),
      })),
    },
    { type: 'context', elements: [{ type: 'mrkdwn', text: `Only the step’s ${T.approver} can answer. The answer is recorded in Signal Flow, with the version of the brief it was given on.` }] },
  ]
}

/** Posts a card in the launch's thread for each step (once per step and brief version). */
export async function postApprovalCards(deps: SlackDeps, workspaceId: string, launchId: string, briefAt: string, cards: CardStep[]): Promise<void> {
  for (const c of cards) {
    const text = `:hourglass_flowing_sand: *${slackText(c.label)}* is waiting${c.waitingFor.length ? ` for ${c.waitingFor.map(slackText).join(' or ')}` : ''}.`
    await reply(deps, workspaceId, launchId, 'card', `card:${c.step}:${briefAt}`, text, cardBlocks(launchId, c, text))
  }
}

/** Once a step is answered (in Signal Flow or in Slack), its cards stop offering buttons and say what was answered. Never throws. */
export async function settleCards(deps: SlackDeps, launchId: string, step: string, text: string): Promise<void> {
  try {
    if (!deps.slack?.live) return
    const rows = (
      await deps.db.query(
        `select p.ts, l.slack_channel_id from delivery.launch_slack_posts p join delivery.launches l on l.id = p.launch_id
          where p.launch_id = $1 and p.kind = 'card' and p.dedupe_key like $2 and p.status = 'sent' and p.ts is not null and l.slack_channel_id is not null`,
        [launchId, `card:${step}:%`],
      )
    ).rows
    for (const r of rows) await deps.slack.updateMessage(r.slack_channel_id, r.ts, text, [{ type: 'section', text: { type: 'mrkdwn', text } }])
  } catch (err) {
    console.error('launch slack card update failed', failure(err))
  }
}
