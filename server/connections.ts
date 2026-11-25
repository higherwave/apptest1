// Connecting a workspace's own Slack, Jira and Salesforce from inside the app (HubSpot has its own file, hubspot-connect.ts, which this follows). An owner pastes the secret into a form; it is TRIED against the
// service first (a wrong token or a missing permission is refused with plain words and nothing is stored), then encrypted with the deployment's own SETTINGS_ENCRYPTION_KEY and kept in
// core.workspace_integrations, exactly as the command-line tool stores it. The secret is never returned, never logged and never shown again; replacing or disconnecting is the only way to change it. Every
// change is audited without the secret. A workspace's own connection wins over the deployment's own settings (which belong to the home workspace); removing it falls back to them.
import type { RequestContext } from './context.js'
import type { Db, Queryable } from './db.js'
import { ApiError } from './errors.js'
import { insertMany } from './sql.js'
import { makeJira } from './jira.js'
import { cleanInstanceUrl, isFieldName, makeSalesforce, SalesforceError, type SalesforceFetch } from './salesforce.js'
import { makeSlack, SlackError, slackProblem, type SlackFetch } from './slack.js'
import { BadHubspotKey, NoEncryptionKey } from './hubspot-connect.js'
import type { JiraFetch } from './jira.js'
import { sealSecret } from '../shared/secret-box.mjs'

/** A malformed field, or a service that refused what was pasted. The message is shown to the owner as it is. */
export class BadConnection extends BadHubspotKey {}
export type ConnectionKind = 'slack' | 'jira' | 'salesforce'
const LABEL: Record<ConnectionKind, string> = { slack: 'Slack', jira: 'Jira', salesforce: 'Salesforce' }
type Env = Record<string, string | undefined>

async function save(db: Db, env: Env, ctx: RequestContext, kind: ConnectionKind, config: Record<string, unknown>, secret: string): Promise<void> {
  let sealed: string
  try {
    sealed = sealSecret(env, secret)
  } catch {
    throw new NoEncryptionKey('This app has no encryption key set, so it cannot store a secret safely. Ask whoever runs Signal Flow to set SETTINGS_ENCRYPTION_KEY.')
  }
  await db.transaction(async (tx) => {
    const had = (await tx.query(`select 1 from core.workspace_integrations where workspace_id = $1 and kind = $2`, [ctx.workspaceId, kind])).rows.length > 0
    await tx.query(
      `insert into core.workspace_integrations (workspace_id, kind, config, secret_enc) values ($1, $2, $3::jsonb, $4)
       on conflict (workspace_id, kind) do update set config = excluded.config, secret_enc = excluded.secret_enc, updated_at = now()`,
      [ctx.workspaceId, kind, JSON.stringify(config), sealed],
    )
    await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.workspace_integrations', entity_id: null, verb: had ? 'replaced key' : 'connected', after: { integration: LABEL[kind] } }])
  })
}

export async function connectSlack(db: Db, env: Env, ctx: RequestContext, input: { token: string }, slackFetch?: SlackFetch): Promise<{ team: string | null }> {
  const token = input.token.trim()
  if (!/^xoxb-[A-Za-z0-9-]{10,200}$/.test(token)) throw new BadConnection('A Slack bot token starts with xoxb-. Copy the Bot User OAuth Token from your Slack app, under OAuth & Permissions.')
  let team: string | null
  try {
    const slack = makeSlack({ SLACK_BOT_TOKEN: token }, slackFetch)
    team = (await slack.check!()).team
  } catch (err) {
    throw new BadConnection(err instanceof SlackError ? slackProblem(err.code) : 'Slack could not be reached. Try again in a moment.')
  }
  await save(db, env, ctx, 'slack', {}, token)
  return { team }
}

/** An address as people type it: with or without https://, with or without a path or a closing slash. The scheme is added when it is missing (only https is ever used). */
const withHttps = (input: string): string => {
  const t = input.trim()
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(t) ? t : `https://${t}`
}

const JIRA_KEY = /^[A-Z][A-Z0-9_]{1,9}$/
export async function connectJira(db: Db, env: Env, ctx: RequestContext, input: { baseUrl: string; email: string; token: string; projectKey: string }, jiraFetch?: JiraFetch): Promise<void> {
  // Only the host matters: a page copied from the browser (https://acme.atlassian.net/jira/software/...) is cut back to the address.
  const baseUrl = (() => {
    try {
      const u = new URL(withHttps(input.baseUrl))
      return u.protocol === 'https:' && !u.username && !u.password ? `https://${u.host}` : input.baseUrl.trim()
    } catch {
      return input.baseUrl.trim()
    }
  })()
  const email = input.email.trim()
  const projectKey = input.projectKey.trim().toUpperCase()
  const token = input.token.trim()
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(baseUrl)) throw new BadConnection('That does not look like a Jira address. It is the web address of your Jira, for example yourcompany.atlassian.net.')
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new BadConnection('Enter the email address of the Jira account the API token belongs to.')
  if (!JIRA_KEY.test(projectKey)) throw new BadConnection('A Jira project key is capital letters, like ACME.')
  if (token.length < 10 || token.length > 400 || /\s/.test(token)) throw new BadConnection('Paste the Jira API token whole, with nothing before or after it.')
  try {
    await makeJira({ baseUrl, email, token, projectKey }, jiraFetch).check()
  } catch (err) {
    if (err instanceof ApiError && err.code === 'jira_refused') throw new BadConnection('Jira refused the sign-in. Check the email and the API token.')
    if (err instanceof ApiError && err.code === 'jira_unreachable') throw new BadConnection('Jira could not be reached. Check the address and try again.')
    if (err instanceof ApiError && err.code === 'jira_rejected') throw new BadConnection('Jira signed in but could not find that project. Check the project key, and that the account can see the project.')
    throw new BadConnection('Jira could not be checked. Try again in a moment.')
  }
  await save(db, env, ctx, 'jira', { baseUrl, email, projectKey }, token)
}

export async function connectSalesforce(db: Db, env: Env, ctx: RequestContext, input: { instanceUrl: string; clientId: string; clientSecret: string; arrField: string }, salesforceFetch?: SalesforceFetch): Promise<void> {
  const instanceUrl = cleanInstanceUrl(withHttps(input.instanceUrl))
  const clientId = input.clientId.trim()
  const clientSecret = input.clientSecret.trim()
  const arrField = input.arrField.trim()
  if (!instanceUrl) throw new BadConnection('That is not a Salesforce address. It ends in .salesforce.com or .force.com, for example yourcompany.my.salesforce.com.')
  if (!/^[A-Za-z0-9._-]{10,200}$/.test(clientId)) throw new BadConnection('The consumer key is the long code from your External Client App (it often starts with 3MVG).')
  if (clientSecret.length < 10 || clientSecret.length > 400 || /\s/.test(clientSecret)) throw new BadConnection('Paste the consumer secret whole, with nothing before or after it.')
  if (!isFieldName(arrField)) throw new BadConnection('The ARR field is the API name of the field on Account, such as ARR__c (a custom field ends in __c).')
  try {
    await makeSalesforce({ instanceUrl, clientId, clientSecret, arrField }, salesforceFetch).check()
  } catch (err) {
    throw new BadConnection(err instanceof SalesforceError ? err.message : 'Salesforce could not be reached. Check the address and try again.')
  }
  await save(db, env, ctx, 'salesforce', { instanceUrl, clientId, arrField }, clientSecret)
}

/** Removes the stored secret. What was already read stays. For Slack and Jira the deployment's own settings (the home workspace's) apply again, if there are any. */
export async function disconnect(db: Db, ctx: RequestContext, kind: ConnectionKind): Promise<void> {
  await db.transaction(async (tx) => {
    const gone = (await tx.query(`delete from core.workspace_integrations where workspace_id = $1 and kind = $2 returning kind`, [ctx.workspaceId, kind])).rows.length > 0
    if (gone) await insertMany(tx, 'core.audit_log', [{ workspace_id: ctx.workspaceId, actor_id: ctx.userId, entity: 'core.workspace_integrations', entity_id: null, verb: 'disconnected', after: { integration: LABEL[kind] } }])
  })
}

export type ConnectionStatus = {
  slack: { connected: boolean; source: 'own' | 'deployment' | 'none' }
  jira: { connected: boolean; source: 'own' | 'deployment' | 'none'; siteUrl: string | null; projectKey: string | null; email: string | null }
  salesforce: { connected: boolean; instanceUrl: string | null; arrField: string | null }
  hubspot: { connected: boolean; portalId: string | null }
}

/** What is connected, with the details that are not secret (the address, the project, the field), never a token or a key. */
export async function connectionStatus(
  db: Queryable,
  workspaceId: string,
  integ: { slack: { live: boolean }; jira: unknown | null; salesforce: unknown | null; hubspot: unknown | null; source: { slack: 'own' | 'deployment' | 'none'; jira: 'own' | 'deployment' | 'none' } },
): Promise<ConnectionStatus> {
  const rows = (await db.query(`select kind, config from core.workspace_integrations where workspace_id = $1`, [workspaceId])).rows as { kind: string; config: Record<string, any> | null }[]
  const cfg = (k: string) => rows.find((r) => r.kind === k)?.config ?? null
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  const jira = cfg('jira')
  const sf = cfg('salesforce')
  const hs = cfg('hubspot')
  return {
    slack: { connected: integ.slack.live, source: integ.source.slack },
    jira: { connected: !!integ.jira, source: integ.source.jira, siteUrl: str(jira?.baseUrl), projectKey: str(jira?.projectKey), email: str(jira?.email) },
    salesforce: { connected: !!integ.salesforce, instanceUrl: str(sf?.instanceUrl), arrField: str(sf?.arrField) },
    hubspot: { connected: !!integ.hubspot, portalId: str(hs?.portalId) },
  }
}
