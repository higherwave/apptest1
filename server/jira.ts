// The Jira connection (Jira Cloud, REST API v3), used by the Create Jira ticket dialog. It is on when JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN and
// JIRA_PROJECT_KEY are all set; otherwise the hand-off stays simulated (server/tickets.ts). One site and one project for the whole app, with an
// API token: a per-person "Connect to Jira" (Atlassian OAuth) is a later step. Nothing here touches the database, so a slow Jira never holds a
// transaction open. `fetch` is passed in so tests can stand in for Jira.
import type { Env } from './db.js'
import { ApiError } from './errors.js'

export type JiraConfig = { baseUrl: string; email: string; token: string; projectKey: string }
export type JiraFetch = (url: string, init?: RequestInit) => Promise<Response>

/** The settings, or null when any is missing (the simulation). The site address is cleaned of a trailing slash. */
export function jiraConfig(env: Env): JiraConfig | null {
  const baseUrl = (env.JIRA_BASE_URL ?? '').trim().replace(/\/+$/, '')
  const email = (env.JIRA_EMAIL ?? '').trim()
  const token = (env.JIRA_API_TOKEN ?? '').trim()
  const projectKey = (env.JIRA_PROJECT_KEY ?? '').trim().toUpperCase()
  if (!/^https?:\/\/\S+$/.test(baseUrl) || !email || !token || !/^[A-Z][A-Z0-9_]{1,9}$/.test(projectKey)) return null
  return { baseUrl, email, token, projectKey }
}

export type JiraStatus = {
  connected: boolean
  siteUrl: string | null
  projectKey: string | null
  projectName: string | null
  issueTypes: string[]
  priorities: string[]
  assignees: { id: string; name: string }[]
  problem: string | null
}
export const NOT_CONNECTED: JiraStatus = { connected: false, siteUrl: null, projectKey: null, projectName: null, issueTypes: [], priorities: [], assignees: [], problem: null }

export type NewIssue = { issueType: string; summary: string; description: string; priority: string; labels: string; assigneeId: string | null }
export type CreatedIssue = { key: string; url: string; project: string }

/** Plain text as Atlassian Document Format: blank lines end a paragraph, lines starting with "•" become a bullet list, links become links. */
export function toAdf(text: string) {
  const inline = (line: string) => {
    const nodes: Record<string, unknown>[] = []
    for (const [i, part] of line.split(/(https?:\/\/[^\s)]+)/).entries()) {
      if (!part) continue
      nodes.push(i % 2 === 1 ? { type: 'text', text: part, marks: [{ type: 'link', attrs: { href: part } }] } : { type: 'text', text: part })
    }
    return nodes
  }
  const content: Record<string, unknown>[] = []
  for (const block of text.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    let bullets: Record<string, unknown>[] = []
    let lines: string[] = []
    const flushLines = () => {
      if (!lines.length) return
      const nodes: Record<string, unknown>[] = []
      lines.forEach((l, i) => {
        if (i > 0) nodes.push({ type: 'hardBreak' })
        nodes.push(...inline(l))
      })
      content.push({ type: 'paragraph', content: nodes })
      lines = []
    }
    const flushBullets = () => {
      if (bullets.length) content.push({ type: 'bulletList', content: bullets })
      bullets = []
    }
    for (const line of block.split('\n')) {
      if (!line.trim()) continue
      if (/^\s*[•*-]\s+/.test(line)) {
        flushLines()
        bullets.push({ type: 'listItem', content: [{ type: 'paragraph', content: inline(line.replace(/^\s*[•*-]\s+/, '')) }] })
      } else {
        flushBullets()
        lines.push(line)
      }
    }
    flushLines()
    flushBullets()
  }
  return { type: 'doc', version: 1, content: content.length ? content : [{ type: 'paragraph', content: [] }] }
}

/** Labels in Jira cannot hold spaces: "a, b c" is three labels. */
export const splitLabels = (labels: string) => [...new Set(labels.split(/[\s,]+/).map((l) => l.trim()).filter(Boolean))].slice(0, 20)

export function makeJira(config: JiraConfig, doFetch: JiraFetch = fetch) {
  const auth = `Basic ${Buffer.from(`${config.email}:${config.token}`).toString('base64')}`
  async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<any> {
    let res: Response
    try {
      res = await doFetch(`${config.baseUrl}/rest/api/3${path}`, {
        method: init.method ?? 'GET',
        headers: { authorization: auth, accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15000),
      })
    } catch {
      throw new ApiError(502, 'jira_unreachable', 'Jira could not be reached. Try again in a moment.')
    }
    const body = await res.json().catch(() => null)
    if (res.ok) return body
    const detail = [...(body?.errorMessages ?? []), ...Object.values(body?.errors ?? {})].filter(Boolean).join(' ')
    if (res.status === 401 || res.status === 403) throw new ApiError(502, 'jira_refused', `Jira refused the sign-in. Check JIRA_EMAIL and JIRA_API_TOKEN.${detail ? ` (${detail})` : ''}`)
    throw new ApiError(502, 'jira_rejected', detail ? `Jira said: ${detail}` : `Jira answered ${res.status}.`)
  }

  // What the dialog offers, read from Jira and kept for five minutes.
  let cached: { at: number; value: JiraStatus } | null = null
  async function status(): Promise<JiraStatus> {
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.value
    const base = { ...NOT_CONNECTED, connected: true, siteUrl: config.baseUrl, projectKey: config.projectKey }
    let value: JiraStatus
    try {
      const [project, priorities, users] = await Promise.all([
        call(`/project/${encodeURIComponent(config.projectKey)}`),
        call('/priority'),
        call(`/user/assignable/search?project=${encodeURIComponent(config.projectKey)}&maxResults=50`),
      ])
      value = {
        ...base,
        projectName: project.name ?? null,
        issueTypes: (project.issueTypes ?? []).filter((t: any) => !t.subtask).map((t: any) => String(t.name)),
        priorities: (priorities ?? []).map((p: any) => String(p.name)),
        assignees: (users ?? []).filter((u: any) => u.accountType === 'atlassian' && u.active !== false).map((u: any) => ({ id: String(u.accountId), name: String(u.displayName) })),
      }
    } catch (err) {
      return { ...base, problem: err instanceof ApiError ? err.message : 'Jira could not be read.' } // not kept, so the next look tries again
    }
    cached = { at: Date.now(), value }
    return value
  }

  async function create(issue: NewIssue): Promise<CreatedIssue> {
    const fields: Record<string, unknown> = {
      project: { key: config.projectKey },
      issuetype: { name: issue.issueType },
      summary: issue.summary,
      description: toAdf(issue.description),
      priority: { name: issue.priority },
    }
    const labels = splitLabels(issue.labels)
    if (labels.length) fields.labels = labels
    if (issue.assigneeId) fields.assignee = { accountId: issue.assigneeId }
    const made = await call('/issue', { method: 'POST', body: { fields } })
    const name = (await status()).projectName
    return { key: String(made.key), url: `${config.baseUrl}/browse/${made.key}`, project: name ? `${config.projectKey} · ${name}` : config.projectKey }
  }

  return { config, status, create }
}
export type Jira = ReturnType<typeof makeJira>
