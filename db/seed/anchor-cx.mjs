// Adds the Anchor CX demo story to the demo workspace, beside what is already there. Nothing else is deleted or changed.
//
//   node seed/anchor-cx.mjs            show what exists and what would change (read-only)
//   node seed/anchor-cx.mjs --yes      load it, in one transaction (run again to reload it)
//
// Only rows with this story's fixed ids are removed and recreated. See seed/anchor-cx/README.md for the story.
import { fileURLToPath } from 'node:url';
import { DEMO_SLUG } from './seed.mjs';
import { ANCHOR_PROJECT_IDS, loadAnchorCx } from './anchor-cx/load.mjs';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: pg } = await import('pg');
  const { loadEnvFile, findConnectionString } = await import('../migrate.mjs');
  loadEnvFile();
  const url = findConnectionString(process.env);
  if (!url) { console.error('No connection string found. See db/README.md.'); process.exit(1); }
  const yes = process.argv.includes('--yes');
  const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
  await client.connect();
  try {
    console.log(`Target: ${new URL(url).host}`);
    const ws = (await client.query('select id from core.workspaces where slug = $1', [DEMO_SLUG])).rows[0];
    if (!ws) { console.error(`There is no workspace "${DEMO_SLUG}" to add to. Load the demo data first (node seed/seed.mjs --yes).`); process.exit(1); }
    const owner = (await client.query(`select user_id from core.memberships where workspace_id = $1 and role = 'owner' order by created_at limit 1`, [ws.id])).rows[0];
    if (!owner) { console.error('The demo workspace has no owner to attribute the projects to.'); process.exit(1); }
    const have = (await client.query('select count(*)::int n from core.projects where id = any($1::uuid[])', [ANCHOR_PROJECT_IDS])).rows[0].n;
    console.log(have ? `Anchor CX is already loaded (${have} projects); it will be replaced.` : 'Anchor CX is not loaded yet; it will be added.');
    console.log(`Touches only: the Anchor CX projects, their platform themes and recommendations, in workspace "${DEMO_SLUG}".`);
    if (!yes) { console.log('\nDry run. Re-run with --yes to load it.'); process.exit(0); }
    await client.query('begin');
    try {
      const summary = await loadAnchorCx(client, { workspaceId: ws.id, userId: owner.user_id });
      await client.query('commit');
      console.log('\nLoaded:');
      for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} ${v}`);
    } catch (e) {
      await client.query('rollback');
      throw new Error('Load failed and was rolled back: ' + e.message);
    }
  } finally {
    await client.end();
  }
}
