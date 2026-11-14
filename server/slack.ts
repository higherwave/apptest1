// The Slack connection, used to post a launch's thread in the team's channel. It is on when SLACK_BOT_TOKEN is set (a bot token, "xoxb-..."); the
// bot needs the chat:write, chat:write.public and channels:read scopes. SLACK_SIGNING_SECRET is for the interactive slice, which verifies requests
// Slack sends us; nothing here uses it. Nothing in this file touches the database. `fetch` is passed in so tests can stand in for Slack.
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Env } from './db.js'

export type SlackFetch = (url: string, init?: RequestInit) => Promise<Response>
export type SlackPost = { channel: string; ts: string }
export type SlackBlocks = Record<string, unknown>[]
export type SlackClient = {
  /** True when a token is set, so posting can reach a real workspace. */
  live: boolean
  /** The id of a public channel from its name (no "#"). */
  channelId(name: string): Promise<string>
  post(channel: string, text: string, threadTs?: string, blocks?: SlackBlocks): Promise<SlackPost>
  /** Changes a message the app posted (the text is what notifications and screen readers show; the blocks are what is drawn). */
  updateMessage(channel: string, ts: string, text: string, blocks?: SlackBlocks): Promise<void>
  /** Opens a form (a modal) for the person who just clicked: the trigger lasts three seconds. */
  openView(triggerId: string, view: Record<string, unknown>): Promise<void>
  /** Answers an interaction through the address Slack gave with it; only Slack's own addresses are used. */
  respond(responseUrl: string, body: Record<string, unknown>): Promise<void>
  permalink(channel: string, ts: string): Promise<string | null>
}

export class SlackError extends Error {
  constructor(public code: string) {
    super(slackProblem(code))
  }
}

/** What a Slack error code means for the person setting it up. */
export function slackProblem(code: string): string {
  switch (code) {
    case 'channel_not_found':
    case 'not_in_channel':
      return 'Slack cannot find that channel, or the Signal Flow app is not in it. Check the name, and invite the app to a private channel.'
    case 'invalid_auth':
    case 'not_authed':
    case 'token_revoked':
    case 'account_inactive':
      return 'Slack refused the token. Check SLACK_BOT_TOKEN.'
    case 'missing_scope':
      return 'The Slack app is missing a permission (scope). It needs chat:write, chat:write.public and channels:read.'
    case 'ratelimited':
      return 'Slack asked us to slow down; it will be tried again.'
    default:
      return `Slack said: ${code}`
  }
}

/** Slack's markup reads &, < and > as its own: user text is escaped so a name or a reason can never mention people or add a link. */
export const slackText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A channel name as typed ("#anchor-cx-launches", " Anchor-CX "): lower case, no "#", or null when it is not a valid name. */
export function cleanChannel(input: string): string | null {
  const name = input.trim().replace(/^#/, '').toLowerCase()
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(name) ? name : null
}

export function makeSlack(env: Env, fetchImpl: SlackFetch = fetch): SlackClient {
  const token = (env.SLACK_BOT_TOKEN ?? '').trim()
  const call = async (method: string, params: Record<string, unknown>, post: boolean): Promise<Record<string, any>> => {
    const url = `https://slack.com/api/${method}`
    const headers = { authorization: `Bearer ${token}` }
    const signal = AbortSignal.timeout(8000)
    const res = post
      ? await fetchImpl(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(params), signal })
      : await fetchImpl(`${url}?${new URLSearchParams(params as Record<string, string>)}`, { headers, signal })
    const body = (await res.json().catch(() => ({}))) as Record<string, any>
    if (!res.ok && !body.error) throw new SlackError(`http_${res.status}`)
    if (!body.ok) throw new SlackError(String(body.error ?? 'unknown_error'))
    return body
  }
  const ids = new Map<string, string>()
  return {
    live: !!token,
    async channelId(name) {
      const known = ids.get(name)
      if (known) return known
      let cursor = ''
      for (let page = 0; page < 10; page++) {
        const body = await call('conversations.list', { types: 'public_channel', exclude_archived: 'true', limit: '1000', ...(cursor ? { cursor } : {}) }, false)
        for (const c of (body.channels ?? []) as { id: string; name: string }[]) ids.set(c.name, c.id)
        const found = ids.get(name)
        if (found) return found
        cursor = body.response_metadata?.next_cursor ?? ''
        if (!cursor) break
      }
      throw new SlackError('channel_not_found')
    },
    async post(channel, text, threadTs, blocks) {
      const body = await call('chat.postMessage', { channel, text, unfurl_links: false, unfurl_media: false, ...(threadTs ? { thread_ts: threadTs } : {}), ...(blocks ? { blocks } : {}) }, true)
      return { channel: String(body.channel), ts: String(body.ts) }
    },
    async updateMessage(channel, ts, text, blocks) {
      await call('chat.update', { channel, ts, text, blocks: blocks ?? [] }, true)
    },
    async openView(triggerId, view) {
      await call('views.open', { trigger_id: triggerId, view }, true)
    },
    async respond(responseUrl, body) {
      // Only Slack's own address: a forged request cannot make the server post somewhere else.
      if (!/^https:\/\/hooks\.slack\.com\//.test(responseUrl)) throw new SlackError('bad_response_url')
      const res = await fetchImpl(responseUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new SlackError(`http_${res.status}`)
    },
    async permalink(channel, ts) {
      try {
        return String((await call('chat.getPermalink', { channel, message_ts: ts }, false)).permalink)
      } catch {
        return null
      }
    },
  }
}

export type SignatureVerdict = 'ok' | 'missing' | 'stale' | 'bad_signature'

/**
 * Checks that a request really came from Slack: the signature is an HMAC of "v0:timestamp:body" with the app's signing secret, compared in constant time,
 * and the timestamp must be within five minutes so an old capture is useless. `now` is in seconds.
 */
export function verifySlackSignature(o: { secret: string | undefined; timestamp: string | undefined; signature: string | undefined; body: string; now?: number }): SignatureVerdict {
  if (!o.secret || !o.timestamp || !o.signature) return 'missing'
  const now = o.now ?? Date.now() / 1000
  if (!/^\d+$/.test(o.timestamp) || Math.abs(now - Number(o.timestamp)) > 300) return 'stale'
  const want = Buffer.from(`v0=${createHmac('sha256', o.secret).update(`v0:${o.timestamp}:${o.body}`).digest('hex')}`)
  const got = Buffer.from(o.signature)
  return got.length === want.length && timingSafeEqual(got, want) ? 'ok' : 'bad_signature'
}
