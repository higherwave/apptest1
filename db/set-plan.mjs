// Puts a workspace on a plan, and optionally gives it its own monthly AI cap instead of the plan's.
//
//   node db/set-plan.mjs --workspace acme --plan pilot                      dry run
//   node db/set-plan.mjs --workspace acme --plan pilot --ai-usd 20 --yes    does it (the cap is in US dollars a month)
//   node db/set-plan.mjs --workspace acme --plan none --yes                 takes the plan away (the deployment's own AI budget applies again)
//
// Plans themselves (core.plans) are edited in the database for now: they are few, and changing one is a deliberate act.
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { findConnectionString, loadEnvFile } from './migrate.mjs';

/** `db` is anything with query(sql, params), so tests can run it on an in-memory database. */
export async function setPlan(db, { slug, plan, aiUsd }) {
  const ws = (await db.query('select id from core.workspaces where slug = $1', [slug])).rows[0];
  if (!ws) throw new Error(`No workspace with the slug "${slug}".`);
  if (!plan) throw new Error('--plan is required (a plan key, or none).');
  let key = null;
  if (plan !== 'none') {
    if (!(await db.query('select 1 from core.plans where key = $1', [plan])).rows[0]) throw new Error(`No plan named "${plan}".`);
    key = plan;
  }
  let cap = null;
  if (aiUsd !== undefined) {
    cap = Number(aiUsd);
    if (!Number.isFinite(cap) || cap < 0) throw new Error('--ai-usd must be zero or more dollars a month.');
  }
  await db.query('update core.workspaces set plan_key = $2, ai_monthly_usd = $3 where id = $1', [ws.id, key, cap]);
  return { workspaceId: ws.id, plan: key, aiUsd: cap };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  loadEnvFile();
  const input = { slug: flag('--workspace'), plan: flag('--plan'), aiUsd: flag('--ai-usd') };
  const url = findConnectionString(process.env);
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).');
    process.exit(1);
  }
  console.log(`Target: ${new URL(url).host}`);
  console.log(`Workspace "${input.slug}" -> plan ${input.plan ?? '(missing)'}${input.aiUsd !== undefined ? `, its own AI cap $${input.aiUsd}/month` : ''}`);
  if (!args.includes('--yes')) {
    console.log('Dry run. Add --yes to do it.');
    process.exit(0);
  }
  const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
  await client.connect();
  try {
    const r = await setPlan(client, input);
    console.log(`Done: plan ${r.plan ?? 'none'}${r.aiUsd !== null ? `, AI cap $${r.aiUsd}/month` : ''} (workspace ${r.workspaceId}).`);
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
