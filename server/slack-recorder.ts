// A stand-in for Slack in tests: it records what the app does (posts, updates, forms opened, replies to interactions) and never leaves the machine.
import { SlackError, type SlackBlocks, type SlackClient } from './slack.js'

export type Recorded = {
  posts: { channel: string; text: string; threadTs?: string; blocks?: SlackBlocks; ts: string }[]
  updates: { channel: string; ts: string; text: string; blocks?: SlackBlocks }[]
  views: { triggerId: string; view: Record<string, any> }[]
  responses: { url: string; body: Record<string, any> }[]
}

export function recordingSlack(opts: { live?: boolean } = {}) {
  const rec: Recorded = { posts: [], updates: [], views: [], responses: [] }
  const state = { failNext: 0, n: 0, failViews: false }
  const slack: SlackClient = {
    live: opts.live ?? true,
    async channelId(name) {
      if (name === 'missing-channel') throw new SlackError('channel_not_found')
      return `C_${name}`
    },
    async post(channel, text, threadTs, blocks) {
      if (state.failNext > 0) {
        state.failNext--
        throw new SlackError('ratelimited')
      }
      const ts = `1700000000.${String(++state.n).padStart(6, '0')}`
      rec.posts.push({ channel, text, threadTs, blocks, ts })
      return { channel, ts }
    },
    async updateMessage(channel, ts, text, blocks) {
      rec.updates.push({ channel, ts, text, blocks })
    },
    async openView(triggerId, view) {
      if (state.failViews) throw new SlackError('expired_trigger_id')
      rec.views.push({ triggerId, view })
    },
    async respond(url, body) {
      rec.responses.push({ url, body })
    },
    async permalink(channel, ts) {
      return `https://example-workspace.slack.test/archives/${channel}/p${ts.replace('.', '')}`
    },
  }
  return { slack, ...rec, rec, state }
}
