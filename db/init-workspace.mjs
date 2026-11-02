// Creates an empty workspace for a new environment: the workspace itself, the four study templates new projects start from, and
// its first owners (invited, so their first sign-in links to them). No demo data. The demo seed is a separate, optional step.
//
//   node db/init-workspace.mjs --name "Acme Research" --slug acme --owners a@acme.com,b@acme.com          dry run
//   node db/init-workspace.mjs --name "Acme Research" --slug acme --owners a@acme.com,b@acme.com --yes    does it
//
// Safe to run again: an existing workspace keeps its data; missing templates are added and owners are promoted, never duplicated.
// Afterwards set WORKSPACE_SLUG=<slug> in the app's environment (see docs/SETUP.md). The connection string comes from the
// environment or db/.env.local, like migrate.mjs.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { bootstrapOwners } from './bootstrap-owners.mjs';
import { findConnectionString, loadEnvFile } from './migrate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = JSON.parse(readFileSync(join(here, 'seed', 'data', 'research.json'), 'utf8')).TEMPLATES;

export const validSlug = (s) => /^[a-z0-9][a-z0-9-]{1,40}$/.test(s);

/** Throws a plain message when the name, slug or owners are not usable. Touches nothing. */
export function checkInput({ name, slug, owners }) {
  if (!name?.trim()) throw new Error('A workspace name is required (--name).');
  if (!validSlug(slug || '')) throw new Error('The slug must be 2 to 41 characters: lowercase letters, digits and hyphens (--slug).');
  if (!owners?.length) throw new Error('At least one owner email is required (--owners), or nobody can sign in.');
  for (const o of owners) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(o.trim())) throw new Error(`"${o}" is not an email address (--owners).`);
}

/** `db` is anything with query(sql, params), so tests can run it on an in-memory database. */
export async function initWorkspace(db, { name, slug, owners }) {
  checkInput({ name, slug, owners });
  let workspace = (await db.query('select id from core.workspaces where slug = $1', [slug])).rows[0];
  const created = !workspace;
  if (!workspace) workspace = (await db.query('insert into core.workspaces (name, slug) values ($1, $2) returning id', [name.trim(), slug])).rows[0];
  const have = new Set((await db.query(`select key from core.templates where workspace_id = $1 and kind = 'study'`, [workspace.id])).rows.map((r) => r.key));
  let templates = 0;
  for (const [key, t] of Object.entries(TEMPLATES)) {
    if (have.has(key)) continue;
    const body = { what: t.what, jWhen: t.jWhen, jWant: t.jWant, jSo: t.jSo, outcomes: t.outcomes, methods: t.methods, tasks: t.tasks };
    await db.query(`insert into core.templates (workspace_id, kind, key, name, description, body) values ($1, 'study', $2, $3, $4, $5)`, [workspace.id, key, t.name, t.desc, JSON.stringify(body)]);
    templates++;
  }
  const done = await bootstrapOwners(db, slug, owners);
  return { workspaceId: workspace.id, created, templatesAdded: templates, owners: done };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const flag = (n) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
  const yes = args.includes('--yes');
  const input = { name: flag('--name'), slug: flag('--slug'), owners: (flag('--owners') || '').split(',').map((e) => e.trim()).filter(Boolean) };
  loadEnvFile();
  const url = findConnectionString(process.env);
  if (!url) {
    console.error('No connection string found. Put it in db/.env.local (see db/README.md).');
    process.exit(1);
  }
  console.log(`Target: ${new URL(url).host}`);
  console.log(`Workspace "${input.name}" (${input.slug}), owners: ${input.owners.join(', ') || 'none'}`);
  if (!yes) {
    console.log('Dry run. Add --yes to create it.');
    process.exit(0);
  }
  const client = new pg.Client({ connectionString: url.replace('sslmode=require', 'sslmode=verify-full') });
  await client.connect();
  try {
    await client.query('begin');
    const r = await initWorkspace(client, input);
    await client.query('commit');
    console.log(`${r.created ? 'Created' : 'Found'} workspace ${r.workspaceId}; ${r.templatesAdded} template(s) added; owners: ${r.owners.join(', ')}.`);
    console.log(`Next: set WORKSPACE_SLUG=${input.slug} in the app's environment, and OPEN_EDITING=false PUBLIC_VIEW=false for a company deployment.`);
  } catch (err) {
    await client.query('rollback').catch(() => {});
    console.error(err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}
