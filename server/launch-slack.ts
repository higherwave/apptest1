// A launch in Slack: one thread per launch, in the channel its team has set. The first message opens the thread (what the launch is, its target date and
// a link to it); what happens next is posted as replies: a request for answers, a step answered, the final decision, an answer the brief reopened.
// Slack carries the conversation and Signal Flow keeps the decisions, so nothing is read back from the thread and nobody approves from Slack.
// A reply goes once (its dedupe key says which event, in launch_slack_posts). A failed post never fails the action that caused it, and Slack being off
// (no token) or a team having no channel is not an error: nothing is posted. REMINDERS_ONLY_FOR limits email to one address; it does not apply here, because a
// channel post has no recipient, so use a channel only you are in while that limit is set.
import { answerLabel } from '../shared/launch.mjs'
import type { Db, Env, Queryable } from './db.js'
import { slackProblem, slackText, SlackError, type SlackClient } from './slack.js'

export type SlackDeps = { db: Db; env: Env; slack?: SlackClient }
export type ThreadResult = { state: 'started' | 'already' | 'off' | 'no_channel' | 'failed'; url: string | null; problem: string | null }

const baseOf = (env: Env) => (env.APP_URL || env.BETTER_AUTH_URL || '').replace(/\/$/, '')

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
    const base = baseOf(env)
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
export async function reply(deps: SlackDeps, workspaceId: string, launchId: string, kind: string, key: string, text: string): Promise<boolean> {
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
      const posted = await slack.post(t.channelId!, text, t.ts!)
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

const reason = (why: string) => (why ? `\n> ${slackText(why).replace(/\n+/g, ' ')}` : '')

export const slackLines = {
  requested: (people: { name: string; steps: string[] }[]) => `:envelope: Answers asked of ${people.map((p) => `${slackText(p.name)} (${slackText(p.steps.join(', '))})`).join('; ')}. They were emailed a link.`,
  answered: (step: string, answer: string, by: string, why: string) => `:white_check_mark: *${slackText(step)}*: ${slackText(answerLabel(answer).toLowerCase())}, by ${slackText(by)}.${reason(why)}`,
  decided: (answer: string, by: string, why: string) => `:rocket: *Final decision: ${slackText(answerLabel(answer).toLowerCase())}*, recorded by ${slackText(by)}.${reason(why)}`,
  reopened: (step: string) => `:arrows_counterclockwise: The brief changed after *${slackText(step)}* was answered. Its reviewer is asked to confirm it.`,
}
