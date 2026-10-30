// Retires the original clinic-booking demo from a workspace: its projects, its Platform Insights themes and recommendations, and its written
// case studies. Found by the fixed ids the seed gave them, so anything else (the Anchor CX demo, a project someone made by hand) is left alone.
//
//   node seed/retire-clinic.mjs            show what exists and what would be removed (read-only)
//   node seed/retire-clinic.mjs --yes      remove it, in one transaction
//
// The clinic demo stays in the seed (seed.mjs) because the tests are built on it; this only takes it out of a workspace that no longer wants it.
import { fileURLToPath } from 'node:url';
import { DEMO_SLUG, uid } from './seed.mjs';

export const CLINIC = {
  projects: ['p1', 'p2', 'p3', 'p4'].map((k) => uid('project:' + k)),
  platformThemes: [0, 1, 2, 3, 4].map((i) => uid('pt:' + i)),
  recommendations: [0, 1, 2, 3].map((i) => uid('rec:' + i)),
  caseStudies: [0, 1, 2, 3].map((i) => uid('case:' + i)),
};

const TABLES = [
  ['projects', 'core.projects', 'name'],
  ['platformThemes', 'insights.platform_themes', 'title'],
  ['recommendations', 'insights.recommendations', 'title'],
  ['caseStudies', 'insights.case_studies', 'title'],
];

// What is there to remove: the rows, by name.
export async function findClinic(db, workspaceId) {
  const found = {};
  for (const [key, table, label] of TABLES) {
    found[key] = (await db.query(`select id, ${label} as label from ${table} where workspace_id = $1 and id = any($2::uuid[]) order by ${label}`, [workspaceId, CLINIC[key]])).rows;
  }
  return found;
}

// Deleting a project removes everything under it (transcripts, themes, documents, board); deleting a platform theme removes its links.
export async function retireClinic(db, workspaceId) {
  const found = await findClinic(db, workspaceId);
  for (const [key, table] of TABLES) {
    if (found[key].length) await db.query(`delete from ${table} where workspace_id = $1 and id = any($2::uuid[])`, [workspaceId, found[key].map((r) => r.id)]);
  }
  return Object.fromEntries(Object.entries(found).map(([k, rows]) => [k, rows.length]));
}

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
    if (!ws) { console.error(`There is no workspace "${DEMO_SLUG}".`); process.exit(1); }
    const found = await findClinic(client, ws.id);
    const total = Object.values(found).reduce((n, rows) => n + rows.length, 0);
    for (const [key, rows] of Object.entries(found)) {
      console.log(`\n${key} (${rows.length})`);
      rows.forEach((r) => console.log(`  ${r.label}`));
    }
    const left = (await client.query('select name from core.projects where workspace_id = $1 and not (id = any($2::uuid[])) order by name', [ws.id, CLINIC.projects])).rows;
    console.log(`\nStays: ${left.map((r) => r.name).join(', ') || 'nothing'}`);
    if (!total) { console.log('\nThe clinic demo is already gone.'); process.exit(0); }
    if (!yes) { console.log('\nDry run. Re-run with --yes to remove them.'); process.exit(0); }
    await client.query('begin');
    try {
      const summary = await retireClinic(client, ws.id);
      await client.query('commit');
      console.log('\nRemoved:', JSON.stringify(summary));
    } catch (e) {
      await client.query('rollback');
      throw new Error('Removal failed and was rolled back: ' + e.message);
    }
  } finally {
    await client.end();
  }
}
