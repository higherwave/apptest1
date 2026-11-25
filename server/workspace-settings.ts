// A workspace's own connections (Slack, Jira), read from core.workspace_integrations with the token decrypted. The deployment's own settings
// (SLACK_BOT_TOKEN, JIRA_*) belong to its home workspace only: any other workspace has no connection until it has its own row, so one
// customer's launches can never post into another's Slack or create issues in another's Jira. Reads go through that workspace's own view of
// the database, and a slow or failing outside service is never waited on here.
import type { Db, Env } from './db.js'
import { jiraConfig, makeJira, type JiraConfig, type JiraFetch } from './jira.js'
import { cleanInstanceUrl, isFieldName, makeSalesforce, type SalesforceClient, type SalesforceFetch } from './salesforce.js'
import { cleanPortalId, makeHubspot, type HubspotClient, type HubspotFetch } from './hubspot.js'
import { makeSlack, type SlackClient, type SlackFetch } from './slack.js'
import { fallbackSlug } from './workspace-host.js'
import { openSecret } from '../shared/secret-box.mjs'

export type JiraClient = ReturnType<typeof makeJira>
export type Integrations = { slack: SlackClient; jira: JiraClient | null; salesforce: SalesforceClient | null; hubspot: HubspotClient | null; source: { slack: 'own' | 'deployment' | 'none'; jira: 'own' | 'deployment' | 'none' } }

export function makeIntegrations(deps: { env: Env; platformDb: () => Db; slack?: SlackClient; slackFetch?: SlackFetch; jiraFetch?: JiraFetch; salesforceFetch?: SalesforceFetch; hubspotFetch?: HubspotFetch }) {
  const { env } = deps
  const cache = new Map<string, { at: number; value: Integrations }>()
  const homeSlack = deps.slack ?? makeSlack(env, deps.slackFetch)
  const homeJiraConfig = jiraConfig(env)
  const homeJira = homeJiraConfig ? makeJira(homeJiraConfig, deps.jiraFetch) : null
  const noSlack = makeSlack({}, deps.slackFetch)

  async function load(workspaceId: string): Promise<Integrations> {
    const { rows } = await deps.platformDb().inWorkspace(workspaceId).query(
      `select w.slug, i.kind, i.config, i.secret_enc from core.workspaces w left join core.workspace_integrations i on i.workspace_id = w.id where w.id = $1`,
      [workspaceId],
    )
    const isHome = rows[0]?.slug === fallbackSlug(env)
    const own = (kind: string) => rows.find((r) => r.kind === kind)
    let slack: SlackClient = isHome ? homeSlack : noSlack
    let jira: JiraClient | null = isHome ? homeJira : null
    const source: Integrations['source'] = { slack: isHome ? 'deployment' : 'none', jira: isHome && homeJira ? 'deployment' : 'none' }
    const s = own('slack')
    if (s) {
      const token = openSecret(env, s.secret_enc)
      slack = token ? makeSlack({ SLACK_BOT_TOKEN: token }, deps.slackFetch) : noSlack
      source.slack = token ? 'own' : 'none'
    }
    const j = own('jira')
    if (j) {
      const token = openSecret(env, j.secret_enc)
      const cfg: JiraConfig | null = token ? jiraConfig({ JIRA_BASE_URL: j.config?.baseUrl, JIRA_EMAIL: j.config?.email, JIRA_API_TOKEN: token, JIRA_PROJECT_KEY: j.config?.projectKey }) : null
      jira = cfg ? makeJira(cfg, deps.jiraFetch) : null
      source.jira = cfg ? 'own' : 'none'
    }
    // Salesforce (read only, for Pulse) has no deployment-wide setting: a workspace connects its own, or has none.
    let salesforce: SalesforceClient | null = null
    const sf = own('salesforce')
    if (sf) {
      const secret = openSecret(env, sf.secret_enc)
      const url = cleanInstanceUrl(String(sf.config?.instanceUrl ?? ''))
      const field = String(sf.config?.arrField ?? '')
      if (secret && url && sf.config?.clientId && isFieldName(field)) salesforce = makeSalesforce({ instanceUrl: url, clientId: String(sf.config.clientId), clientSecret: secret, arrField: field }, deps.salesforceFetch)
    }
    // HubSpot (read only, for Pulse's support tickets): like Salesforce, a workspace connects its own service key, or has none.
    let hubspot: HubspotClient | null = null
    const hs = own('hubspot')
    if (hs) {
      const token = openSecret(env, hs.secret_enc)
      if (token) hubspot = makeHubspot({ token, portalId: cleanPortalId(hs.config?.portalId) }, deps.hubspotFetch)
    }
    return { slack, jira, salesforce, hubspot, source }
  }

  return async (workspaceId: string): Promise<Integrations> => {
    const hit = cache.get(workspaceId)
    if (hit && Date.now() - hit.at < 60_000) return hit.value
    const value = await load(workspaceId)
    cache.set(workspaceId, { at: Date.now(), value })
    return value
  }
}
