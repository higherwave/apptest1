// Connects one workspace to its own Slack or Jira. The token is read from an environment variable (never typed as an argument, so it stays out of
// the shell history and the chat), encrypted with SETTINGS_ENCRYPTION_KEY and stored in core.workspace_integrations.
//
//   SLACK_TOKEN=xoxb-... node db/set-integration.mjs --workspace acme --kind slack --secret-env SLACK_TOKEN          dry run
//   JIRA_TOKEN=...       node db/set-integration.mjs --workspace acme --kind jira --secret-env JIRA_TOKEN \
//        --site https://acme.atlassian.net --email me@acme.com --project ACME --yes                                   does it
//   SF_SECRET=...        node db/set-integration.mjs --workspace acme --kind salesforce --secret-env SF_SECRET \
//        --site https://acme.my.salesforce.com --client-id 3MVG... --arr-field ARR__c --yes                          Salesforce, read only (Pulse)
//   node db/set-integration.mjs --workspace acme --kind slack --remove --yes                                          disconnects it
//
// SETTINGS_ENCRYPTION_KEY (openssl rand -base64 32) must be the same key the app has in its environment, or it cannot read what is stored.
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { findConnectionString, loadEnvFile } from './migrate.mjs';
import { sealSecret } from '../shared/secret-box.mjs';

/** The row to store, or throws a plain message. Touches nothing. */
export function buildRow(env, { kind, secret, site, email, project, clientId, arrField }) {
  if (!['slack', 'jira', 'salesforce'].includes(kind)) throw new Error('--kind must be slack, jira or salesforce.');
  if (!secret) throw new Error('The token is missing: name the environment variable that holds it with --secret-env.');
  if (kind === 'slack') {
    if (!/^xoxb-/.test(secret)) throw new Error('A Slack bot token starts with xoxb-.');
    return { kind, config: {}, secret_enc: sealSecret(env, secret) };
  }
  if (kind === 'salesforce') {
    let host = '';
    try { const u = new URL(String(site ?? '').trim()); if (u.protocol === 'https:' && /(^|\.)(salesforce|force)\.com$/i.test(u.hostname) && !u.username && !u.password) host = u.host; } catch { /* below */ }
    if (!host) throw new Error('--site must be the Salesforce address, https and ending in .salesforce.com or .force.com (for example https://acme.my.salesforce.com).');
    if (!/^[A-Za-z0-9._-]{10,200}$/.test(String(clientId ?? ''))) throw new Error('--client-id must be the app\'s consumer key.');
    if (!/^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(String(arrField ?? ''))) throw new Error('--arr-field must be the API name of the ARR field on Account, such as ARR__c.');
    return { kind, config: { instanceUrl: `https://${host}`, clientId: String(clientId), arrField: String(arrField) }, secret_enc: sealSecret(env, secret) };
  }
  const baseUrl = String(site ?? '').trim().replace(/\/+$/, '');
  if (!/^https:\/\/\S+$/.test(baseUrl)) throw new Error('--site must be the Jira address, starting with https://.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email ?? ''))) throw new Error('--email must be the Jira account email.');
  const projectKey = String(project ?? '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,9}$/.test(projectKey)) throw new Error('--project must be the Jira project key, such as ACME.');
  return { kind, config: { baseUrl, email: String(email).trim(), projectKey }, secret_enc: sealSecret(env, secret) };
}

/** `db` is anything with query(sql, params), so tests can run it on an in-memory database. */
export async function setIntegration(db, env, { slug, remove, ...input }) {
  const ws = (await db.query('select id from core.workspaces where slug = $1', [slug])).rows[0];
  if (!ws) throw new Error(`No workspace with the slug "${slug}".`);
  if (remove) {
    if (!['slack', 'jira', 'salesforce'].includes(input.kind)) throw new Error('--kind must be slack, jira or salesforce.');
    const r = await db.query('delete from core.workspace_integrations where workspace_id = $1 and kind = $2 returning kind', [ws.id, input.kind]);
    return { workspaceId: ws.id, kind: input.kind, action: r.rows.length ? 'removed' : 'nothing to remove' };
  }
  const row = buildRow(env, input);
  await db.query(
    `insert into core.workspace_integrations (workspace_id, kind, config, secret_enc) values ($1, $2, $3, $4)
     on conflict (workspace_id, kind) do update set config = excluded.config, secret_enc = excluded.secret_enc, updated_at = now()`,
    [ws.id, row.kind, JSON.stringify(row.config), row.secret_enc],
  );
  return { workspaceId: ws.id, kind: row.kind, action: 'saved' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  loadEnvFile();
  const input = { slug: flag('--workspace'), kind: flag('--kind'), remove: args.includes('--remove'), site: flag('--site'), email: flag('--email'), project: flag('--project'), clientId: flag('--client-id'), arrField: flag('--arr-field') };
  const secretEnv = flag('--secret-env');
  input.secret = secretEnv ? process.env[secretEnv] : undefined;
  const yes = args.includes('--yes');
  const url = findConnectionString(process.env);
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).');
    process.exit(1);
  }
  console.log(`Target: ${new URL(url).host}`);
  console.log(`${input.remove ? 'Remove' : 'Connect'} ${input.kind} for workspace "${input.slug}"${input.remove ? '' : ` (token from ${secretEnv ?? 'nowhere'})`}`);
  try {
    if (!input.remove) buildRow(process.env, input); // checks everything, including the key, before touching the database
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  if (!yes) {
    console.log('Dry run. Add --yes to do it.');
    process.exit(0);
  }
  const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
  await client.connect();
  try {
    const r = await setIntegration(client, process.env, input);
    console.log(`${r.kind}: ${r.action} (workspace ${r.workspaceId}).`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
