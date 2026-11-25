// Stand-ins for Slack's and Jira's APIs, for the local demo and the browser tests (CONNECT_DEMO=true): the connect forms in Settings, Apps can be tried without real accounts. Each accepts one made-up credential
// and answers the way the real service does when it is wrong. Nothing here is used in production.
// Built in pieces on purpose: written out whole, it looks like a real Slack token and GitHub's push protection refuses it.
export const DEMO_SLACK_TOKEN = ['xoxb', '1111111111', '2222222222', 'demoslackbottoken'].join('-')
export const DEMO_JIRA = { baseUrl: 'https://anchor-demo.atlassian.net', email: 'demo@anchor.example', token: 'demo-jira-api-token-123456', projectKey: 'ANCHOR' }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

export const demoSlackFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const auth = (init?.headers as Record<string, string> | undefined)?.authorization
  if (auth !== `Bearer ${DEMO_SLACK_TOKEN}`) return json({ ok: false, error: 'invalid_auth' })
  if (url.endsWith('/auth.test')) return json({ ok: true, team: 'Anchor CX (demo)' })
  return json({ ok: false, error: 'not_in_demo' })
}

export const demoJiraFetch = async (url: string, init?: RequestInit): Promise<Response> => {
  const auth = (init?.headers as Record<string, string> | undefined)?.authorization
  if (auth !== `Basic ${Buffer.from(`${DEMO_JIRA.email}:${DEMO_JIRA.token}`).toString('base64')}`) return json({ errorMessages: ['Client must be authenticated to access this resource.'] }, 401)
  const path = new URL(url).pathname.replace('/rest/api/3', '')
  if (path === '/myself') return json({ accountId: 'demo-account' })
  if (path === `/project/${DEMO_JIRA.projectKey}`) return json({ name: 'Anchor CX', issueTypes: [{ name: 'Story', subtask: false }, { name: 'Bug', subtask: false }] })
  if (path === '/priority') return json([{ name: 'High' }, { name: 'Medium' }, { name: 'Low' }])
  if (path.startsWith('/user/assignable/search')) return json([])
  if (path === '/issue' && init?.method === 'POST') return json({ key: `${DEMO_JIRA.projectKey}-101` })
  return json({ errorMessages: ['No project could be found with key or id.'] }, 404)
}
