// Adds the Anchor CX demo story to the demo workspace, beside what is already there. Nothing else is deleted or changed.
//
//   node seed/anchor-cx.mjs            show what exists and what would change (read-only)
//   node seed/anchor-cx.mjs --yes      load it, in one transaction (run again to reload it)
//   node seed/anchor-cx.mjs --yes --replace-hand-built
//                                      reload even though the studies hold content built by hand (a requirements document, a launch...): it is DELETED. Without this flag a
//                                      reload refuses and says what it would delete. If the example workflow is in the workspace, the studies are put back on it.
//   node seed/anchor-cx.mjs --add-themes [--yes]
//                                      add only the two later themes (and their transcript lines) to a story that is already loaded, WITHOUT reloading it:
//                                      a reload deletes the three studies and anything built on them by hand. Inserts and updates only; safe to run again.
//
// Only rows with this story's fixed ids are removed and recreated. See seed/anchor-cx/README.md for the story.
import { fileURLToPath } from 'node:url';
import { DEMO_SLUG } from './seed.mjs';
import { ANCHOR_PROJECT_IDS, HandBuiltContentError, addLaterThemes, handBuiltContent, loadAnchorCx } from './anchor-cx/load.mjs';

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
    if (process.argv.includes('--add-themes')) {
      if (!have) { console.error('Anchor CX is not loaded here, so there is nothing to add the themes to.'); process.exit(1); }
      console.log(`Anchor CX is loaded (${have} projects). Adding only the later themes: inserts and updates of rows this story owns, nothing deleted.`);
      await client.query('begin');
      try {
        const did = await addLaterThemes(client, { workspaceId: ws.id, userId: owner.user_id });
        if (!yes) { await client.query('rollback'); console.log('\nDry run (rolled back). It would add:'); } else { await client.query('commit'); console.log('\nAdded:'); }
        for (const [k, v] of Object.entries(did)) console.log(`  ${k.padEnd(18)} ${v}`);
        if (!yes) console.log('\nRe-run with --add-themes --yes to apply it.');
      } catch (e) {
        await client.query('rollback');
        throw new Error('Nothing was changed: ' + e.message);
      }
      process.exit(0);
    }
    console.log(have ? `Anchor CX is already loaded (${have} projects); it will be replaced.` : 'Anchor CX is not loaded yet; it will be added.');
    if (have) {
      const found = await handBuiltContent(client, ws.id);
      if (found.length) {
        console.log('\nA reload would DELETE content built by hand on these studies:');
        for (const f of found) console.log(`  ${f.count} ${f.what}: ${f.items.join('; ')}${f.count > f.items.length ? '; …' : ''}`);
        console.log(process.argv.includes('--replace-hand-built') ? '\n--replace-hand-built was given: it will be deleted.' : '\nA reload will refuse while this is here. To add to the story instead, use --add-themes; to reload anyway, add --replace-hand-built.');
      }
    }
    console.log(`Touches only: the Anchor CX projects, their platform themes and recommendations, in workspace "${DEMO_SLUG}".`);
    if (!yes) { console.log('\nDry run. Re-run with --yes to load it.'); process.exit(0); }
    await client.query('begin');
    try {
      const summary = await loadAnchorCx(client, { workspaceId: ws.id, userId: owner.user_id, replaceHandBuilt: process.argv.includes('--replace-hand-built') });
      await client.query('commit');
      console.log('\nLoaded:');
      for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(18)} ${v}`);
    } catch (e) {
      await client.query('rollback');
      throw new Error((e instanceof HandBuiltContentError ? 'Nothing was changed (rolled back): ' : 'Load failed and was rolled back: ') + e.message);
    }
  } finally {
    await client.end();
  }
}
