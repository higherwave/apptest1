// The Slack connection, used to post a launch's thread in the team's channel. It is on when SLACK_BOT_TOKEN is set (a bot token, "xoxb-..."); the
// bot needs the chat:write, chat:write.public and channels:read scopes. SLACK_SIGNING_SECRET is for the interactive slice, which verifies requests
// Slack sends us; nothing here uses it. Nothing in this file touches the database. `fetch` is passed in so tests can stand in for Slack.
import type { Env } from './db.js'

export type SlackFetch = (url: string, init?: RequestInit) => Promise<Response>
export type SlackPost = { channel: string; ts: string }
export type SlackClient = {
  /** True when a token is set, so posting can reach a real workspace. */
  live: boolean
  /** The id of a public channel from its name (no "#"). */
  channelId(name: string): Promise<string>
  post(channel: string, text: string, threadTs?: string): Promise<SlackPost>
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
  const call = async (method: string, params: Record<string, string>, post: boolean): Promise<Record<string, any>> => {
    const url = `https://slack.com/api/${method}`
    const headers = { authorization: `Bearer ${token}` }
    const signal = AbortSignal.timeout(8000)
    const res = post
      ? await fetchImpl(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(params), signal })
      : await fetchImpl(`${url}?${new URLSearchParams(params)}`, { headers, signal })
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
    async post(channel, text, threadTs) {
      const body = await call('chat.postMessage', { channel, text, unfurl_links: 'false', unfurl_media: 'false', ...(threadTs ? { thread_ts: threadTs } : {}) }, true)
      return { channel: String(body.channel), ts: String(body.ts) }
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
