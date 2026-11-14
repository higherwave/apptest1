// What Slack sends us when someone acts on a launch there: a click on an approval card, the form's submission, the "Add link as evidence" message action, and the
// /signalflow command. Slack signs every request (checked in the route before any of this runs) and expects an answer within three seconds, so a click opens a form
// at once and the answer is recorded when the form is submitted. Who someone is comes only from a link made with a one-time code (slack-link.ts); what they may do is
// exactly what they could do in Signal Flow: the same functions run, as the same member, so no rule is repeated here. Answers and links are recorded in Signal Flow;
// Slack only carries the conversation.
import { answerLabel, answersFor, rationaleRequired, stepLabel } from '../shared/launch.mjs'
import { contextForUser } from './context.js'
import type { Db, Env } from './db.js'
import { addLink, answerStep, assertCanAnswer, BadAnswer, BadLink, getLaunch, LaunchNotFound, NeedsRationale, NotTheReviewer, StepNotUsed } from './launches.js'
import { noticeAnswered } from './launch-notices.js'
import { reply } from './launch-slack.js'
import type { Mailer } from './mailer.js'
import { slackText, type SlackClient } from './slack.js'
import { disconnectSlack, memberOfSlackUser, redeemConnectCode, slackStatus } from './slack-link.js'

export type InteractDeps = { db: Db; env: Env; mailer: Mailer; slack: SlackClient }
type Json = Record<string, any>

const baseOf = (env: Env) => (env.APP_URL || env.BETTER_AUTH_URL || '').replace(/\/$/, '')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const stepName = (key: string): string => stepLabel(key) ?? key
const TAIL_MS = 2000

// Work that follows a submitted form (the email, the thread reply) must not hold the three-second answer for long.
const withinTime = (job: Promise<unknown>) => Promise.race([job.catch((err) => console.error('slack follow-up failed', err instanceof Error ? err.message : err)), new Promise((r) => setTimeout(r, TAIL_MS))])

const slackUserOf = (payload: Json) => ({ teamId: String(payload.team?.id ?? payload.user?.team_id ?? ''), userId: String(payload.user?.id ?? '') })

/** A message only the person who clicked sees. */
const ephemeral = (deps: InteractDeps, payload: Json, text: string) =>
  payload.response_url ? deps.slack.respond(payload.response_url, { response_type: 'ephemeral', replace_original: false, text }).catch((err) => console.error('slack respond failed', err instanceof Error ? err.message : err)) : Promise.resolve()

const CONNECT_HELP = 'Signal Flow does not know which member you are yet. In Signal Flow, open your account menu, choose Connect Slack, and enter the code here with /signalflow connect <code>.'

/** The member a Slack user is, as the context their own requests carry; or the reason they cannot act. */
async function actor(deps: InteractDeps, payload: Json, workspaceId: string, answerAt: string) {
  const link = await memberOfSlackUser(deps.db, slackUserOf(payload))
  if (!link || link.workspaceId !== workspaceId) return { ok: false as const, text: `${CONNECT_HELP}${answerAt ? ` Or answer in Signal Flow: ${answerAt}` : ''}` }
  const ctx = await contextForUser(deps.db, workspaceId, link.userId)
  return ctx ? { ok: true as const, ctx } : { ok: false as const, text: 'You are no longer a member of this workspace.' }
}

const refusal = (err: unknown, launchName: string, step: string): string | null => {
  if (err instanceof NotTheReviewer) return err.who.length ? `Only ${err.who.join(' or ')} can answer ${stepName(step)} on ${launchName}. Your click was not recorded.` : `Nobody is set up to answer ${stepName(step)} yet, so your click was not recorded. An owner can add a reviewer in Signal Flow.`
  if (err instanceof StepNotUsed) return `${launchName} does not use ${stepName(step)}.`
  if (err instanceof LaunchNotFound) return 'That launch is not available to you.'
  return null
}

const modal = (o: { callbackId: string; title: string; meta: Json; blocks: Json[] }) => ({
  type: 'modal',
  callback_id: o.callbackId,
  title: { type: 'plain_text', text: o.title.slice(0, 24) },
  submit: { type: 'plain_text', text: 'Record' },
  close: { type: 'plain_text', text: 'Cancel' },
  private_metadata: JSON.stringify(o.meta),
  blocks: o.blocks,
})

async function launchRow(db: Db, id: string): Promise<{ id: string; workspaceId: string; name: string } | null> {
  if (!UUID.test(id)) return null
  const r = (await db.query(`select id, workspace_id, name from delivery.launches where id = $1`, [id])).rows[0]
  return r ? { id: r.id, workspaceId: r.workspace_id, name: r.name } : null
}

/** A click on an answer button: check who they are and that they may answer, then open the form for the reason. */
async function clicked(deps: InteractDeps, payload: Json): Promise<void> {
  const action = payload.actions?.[0]
  const id = String(action?.action_id ?? '')
  if (!id.startsWith('answer:')) return
  const [launchId = '', step = ''] = String(action.value ?? '').split('|')
  const answer = id.slice('answer:'.length)
  const launch = await launchRow(deps.db, launchId)
  if (!launch || !answersFor(step).some((a: { key: string }) => a.key === answer)) return void (await ephemeral(deps, payload, 'That launch is not available.'))
  const base = baseOf(deps.env)
  const who = await actor(deps, payload, launch.workspaceId, base ? `${base}/launches/${launch.id}?step=${step}` : '')
  if (!who.ok) return void (await ephemeral(deps, payload, who.text))
  try {
    await assertCanAnswer(deps.db, who.ctx, launch.id, step)
  } catch (err) {
    const why = refusal(err, launch.name, step)
    if (why) return void (await ephemeral(deps, payload, why))
    throw err
  }
  const required = rationaleRequired(answer)
  await deps.slack.openView(
    String(payload.trigger_id),
    modal({
      callbackId: 'answer',
      title: `${stepName(step)}: ${answerLabel(answer)}`,
      meta: { launchId: launch.id, step, answer },
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*${slackText(launch.name)}*\n${slackText(stepName(step))}: *${slackText(answerLabel(answer).toLowerCase())}*` } },
        {
          type: 'input',
          block_id: 'why',
          optional: !required,
          label: { type: 'plain_text', text: required ? 'Why? (needed for this answer)' : 'Why? (optional)' },
          element: { type: 'plain_text_input', action_id: 'why', multiline: true, max_length: 2000 },
        },
      ],
    }),
  )
}

/** The answer form was submitted: record it as the member, then tell the thread. Returns what Slack should do with the form (errors keep it open). */
async function submittedAnswer(deps: InteractDeps, payload: Json): Promise<Json | null> {
  const meta = JSON.parse(String(payload.view.private_metadata || '{}')) as { launchId: string; step: string; answer: string }
  const launch = await launchRow(deps.db, meta.launchId)
  if (!launch) return { response_action: 'errors', errors: { why: 'That launch is not available.' } }
  const who = await actor(deps, payload, launch.workspaceId, '')
  if (!who.ok) return { response_action: 'errors', errors: { why: who.text } }
  const why = String(payload.view.state?.values?.why?.why?.value ?? '')
  try {
    await answerStep(deps.db, who.ctx, launch.id, meta.step, { answer: meta.answer, rationale: why })
  } catch (err) {
    if (err instanceof NeedsRationale) return { response_action: 'errors', errors: { why: 'Say why: this answer needs a reason.' } }
    if (err instanceof BadAnswer) return { response_action: 'errors', errors: { why: 'That is not an answer for this step.' } }
    const text = refusal(err, launch.name, meta.step)
    if (text) return { response_action: 'errors', errors: { why: text } }
    throw err
  }
  // The owner is emailed and the thread hears it (and the card stops offering buttons), the same as an answer given in Signal Flow.
  await withinTime(noticeAnswered({ db: deps.db, env: deps.env, mailer: deps.mailer, slack: deps.slack }, launch.workspaceId, launch.id, meta.step, who.ctx.userId))
  return null
}

const FIRST_URL = /https?:\/\/[^\s<>|]+/i

/** "Add link as evidence" on a message in a launch's thread: a form to pick the step and confirm the link. */
async function messageAction(deps: InteractDeps, payload: Json): Promise<void> {
  const channel = String(payload.channel?.id ?? '')
  const threadTs = String(payload.message?.thread_ts ?? payload.message?.ts ?? '')
  const row = (await deps.db.query(`select id, workspace_id, name from delivery.launches where slack_channel_id = $1 and slack_thread_ts = $2`, [channel, threadTs])).rows[0]
  if (!row) return void (await ephemeral(deps, payload, 'This is not a launch thread, so there is nowhere to add the link.'))
  const who = await actor(deps, payload, row.workspace_id, '')
  if (!who.ok) return void (await ephemeral(deps, payload, who.text))
  const launch = await getLaunch(deps.db, who.ctx, row.id)
  const mine = launch?.steps.filter((s) => s.canAnswer) ?? []
  if (!launch || mine.length === 0) return void (await ephemeral(deps, payload, `You are not a reviewer of any step of ${row.name}, so you cannot add evidence to it.`))
  const url = FIRST_URL.exec(String(payload.message?.text ?? ''))?.[0]
  await deps.slack.openView(String(payload.trigger_id), {
    ...modal({
      callbackId: 'evidence',
      title: 'Add link as evidence',
      meta: { launchId: row.id },
      blocks: [
        { type: 'input', block_id: 'step', label: { type: 'plain_text', text: 'For which step?' }, element: { type: 'static_select', action_id: 'step', options: mine.map((s) => ({ text: { type: 'plain_text', text: s.label }, value: s.step })), ...(mine.length === 1 ? { initial_option: { text: { type: 'plain_text', text: mine[0].label }, value: mine[0].step } } : {}) } },
        { type: 'input', block_id: 'url', label: { type: 'plain_text', text: 'Link' }, element: { type: 'plain_text_input', action_id: 'url', ...(url ? { initial_value: url } : {}) } },
        { type: 'input', block_id: 'title', optional: true, label: { type: 'plain_text', text: 'Title (optional)' }, element: { type: 'plain_text_input', action_id: 'title', max_length: 120 } },
      ],
    }),
    submit: { type: 'plain_text', text: 'Add' },
  })
}

async function submittedEvidence(deps: InteractDeps, payload: Json): Promise<Json | null> {
  const meta = JSON.parse(String(payload.view.private_metadata || '{}')) as { launchId: string }
  const launch = await launchRow(deps.db, meta.launchId)
  if (!launch) return { response_action: 'errors', errors: { url: 'That launch is not available.' } }
  const who = await actor(deps, payload, launch.workspaceId, '')
  if (!who.ok) return { response_action: 'errors', errors: { step: who.text } }
  const v = payload.view.state?.values ?? {}
  const step = String(v.step?.step?.selected_option?.value ?? '')
  const url = String(v.url?.url?.value ?? '').trim()
  const title = String(v.title?.title?.value ?? '')
  try {
    await addLink(deps.db, who.ctx, launch.id, step, { title, url })
  } catch (err) {
    if (err instanceof BadLink) return { response_action: 'errors', errors: { url: 'Enter a link that starts with http:// or https://.' } }
    if (err instanceof BadAnswer) return { response_action: 'errors', errors: { step: 'Choose a step.' } }
    const text = refusal(err, launch.name, step)
    if (text) return { response_action: 'errors', errors: { step: text } }
    throw err
  }
  const safeUrl = url.replace(/[<>|]/g, encodeURIComponent)
  await withinTime(reply({ db: deps.db, env: deps.env, slack: deps.slack }, launch.workspaceId, launch.id, 'evidence', `evidence:${step}:${url}`, `:paperclip: *${slackText(stepName(step))}*: ${slackText(who.ctx.displayName)} added a link as evidence: <${safeUrl}|${slackText(title.trim() || url)}>`))
  return null
}

/** Everything Slack posts to the interactivity address. The result is the JSON Slack should get back, or null for an empty answer. */
export async function handleInteraction(deps: InteractDeps, payload: Json): Promise<Json | null> {
  switch (payload.type) {
    case 'block_actions':
      await clicked(deps, payload)
      return null
    case 'message_action':
      if (payload.callback_id === 'add_evidence') await messageAction(deps, payload)
      return null
    case 'view_submission':
      if (payload.view?.callback_id === 'answer') return submittedAnswer(deps, payload)
      if (payload.view?.callback_id === 'evidence') return submittedEvidence(deps, payload)
      return null
    default:
      return null
  }
}

/** /signalflow connect <code>, disconnect, or status. The reply is private to the person who typed it. */
export async function handleCommand(deps: InteractDeps, form: URLSearchParams): Promise<{ response_type: 'ephemeral'; text: string }> {
  const slackUser = { teamId: form.get('team_id') ?? '', userId: form.get('user_id') ?? '' }
  const [sub = '', ...rest] = (form.get('text') ?? '').trim().split(/\s+/)
  const say = (text: string) => ({ response_type: 'ephemeral' as const, text })
  if (sub.toLowerCase() === 'connect') {
    const done = await redeemConnectCode(deps.db, rest.join(' '), slackUser)
    return done
      ? say(`Connected. You are ${done.name} in Signal Flow, so the answer buttons now work for the steps you review.`)
      : say('That code did not work: it may be mistyped, already used or older than ten minutes. In Signal Flow, open your account menu and choose Connect Slack for a new one.')
  }
  const link = await memberOfSlackUser(deps.db, slackUser)
  if (sub.toLowerCase() === 'disconnect') {
    if (!link) return say('This Slack account is not connected to Signal Flow.')
    await disconnectSlack(deps.db, link.userId)
    return say('Disconnected. The answer buttons will ask you to connect again.')
  }
  const status = link ? await slackStatus(deps.db, link.userId) : null
  return say(status?.connected ? 'This Slack account is connected to Signal Flow. Use /signalflow disconnect to undo it.' : 'This Slack account is not connected to Signal Flow yet. In Signal Flow, open your account menu, choose Connect Slack, then use /signalflow connect <code> here.')
}
