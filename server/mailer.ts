import type { Env } from './db.js'

// The one seam between the app and any mail service, like the AI provider seam. A message goes in as plain parts; what delivers it
// (Microsoft Graph, or a recorder in tests) is chosen here and never leaks out. Nothing in the app names a sender address: it
// comes from MAIL_FROM.
export type Mail = { to: string; subject: string; text: string; html: string }
export type Mailer = {
  name: string
  /** True when send() can reach a real inbox. A recorder or an unconfigured sender is not live. */
  live: boolean
  send(mail: Mail): Promise<void>
}

export class MailNotConfigured extends Error {
  constructor() {
    super('Email is not set up: MAIL_TENANT_ID, MAIL_CLIENT_ID, MAIL_CLIENT_SECRET and MAIL_FROM are all needed.')
  }
}

type Fetch = typeof fetch

// Microsoft Graph with an app registration (client credentials). The Mail.Send application permission is limited to one mailbox by an
// Exchange application access policy, so this app can send as MAIL_FROM and nobody else.
export function graphMailer(env: Env, fetchImpl: Fetch = fetch): Mailer | undefined {
  const { MAIL_TENANT_ID: tenant, MAIL_CLIENT_ID: id, MAIL_CLIENT_SECRET: secret, MAIL_FROM: from } = env
  if (!tenant || !id || !secret || !from) return undefined
  let token: { value: string; expires: number } | undefined
  const accessToken = async (): Promise<string> => {
    if (token && token.expires > Date.now() + 60_000) return token.value
    const res = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: id, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }),
    })
    if (!res.ok) throw new Error(`Microsoft sign-in for mail failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
    const body = (await res.json()) as { access_token: string; expires_in: number }
    token = { value: body.access_token, expires: Date.now() + body.expires_in * 1000 }
    return token.value
  }
  return {
    name: 'graph',
    live: true,
    async send(mail) {
      const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(from)}/sendMail`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          message: { subject: mail.subject, body: { contentType: 'HTML', content: mail.html }, toRecipients: [{ emailAddress: { address: mail.to } }] },
          saveToSentItems: false,
        }),
      })
      // Graph answers 202 Accepted with no body.
      if (res.status !== 202) {
        token = undefined
        throw new Error(`Microsoft Graph refused the message (${res.status}): ${(await res.text()).slice(0, 300)}`)
      }
    },
  }
}

// Used when no sender is configured: every send fails with a clear reason, so the reminder shows as "failed" instead of silently vanishing.
const unconfigured: Mailer = {
  name: 'none',
  live: false,
  async send() {
    throw new MailNotConfigured()
  },
}

// MAIL_ENABLED=false is the kill switch, like AI_ENABLED.
export function getMailer(env: Env): Mailer {
  if (env.MAIL_ENABLED === 'false') return unconfigured
  return graphMailer(env) ?? unconfigured
}

// For tests: keeps what would have been sent.
export function recordingMailer(): Mailer & { sent: Mail[]; failNext?: string } {
  const sent: Mail[] = []
  const m: Mailer & { sent: Mail[]; failNext?: string } = {
    name: 'recorder',
    live: true,
    sent,
    async send(mail) {
      if (m.failNext) {
        const why = m.failNext
        m.failNext = undefined
        throw new Error(why)
      }
      sent.push(mail)
    },
  }
  return m
}
