// Tests the migrations against an in-memory Postgres (PGlite). Uses no Neon compute.
//   npm test
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrationFiles } from './migrate.mjs';
import { findViolations } from './check-deps.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'migrations');
let passed = 0;
const failures = [];

async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const eq = (a, b, msg) => { if (a !== b) throw new Error(`${msg}: expected ${b}, got ${a}`); };
async function rejects(db, sql, params, contains) {
  try { await db.query(sql, params); } catch (e) {
    if (contains && !String(e.message).toLowerCase().includes(contains)) throw new Error(`wrong error: ${e.message}`);
    return;
  }
  throw new Error('expected an error but the statement succeeded');
}
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];

const sql = (f) => readFileSync(join(dir, f), 'utf8');
const up = async (db) => { for (const f of migrationFiles()) await db.exec(sql(f)); };
const down = async (db) => { for (const f of [...migrationFiles()].reverse()) await db.exec(sql(f.replace(/\.sql$/, '.down.sql'))); };

const db = new PGlite();
console.log('Signal Flow schema tests');

await test('migrations apply', async () => { await up(db); });

await test('table counts: 11 core, 11 research, 7 delivery, 6 insights (35)', async () => {
  const { rows } = await db.query(`select table_schema s, count(*)::int n from information_schema.tables
    where table_type = 'BASE TABLE' and table_schema in ('core','research','delivery','insights') group by 1`);
  const got = Object.fromEntries(rows.map((r) => [r.s, r.n]));
  eq(got.core, 11, 'core'); eq(got.research, 11, 'research'); eq(got.delivery, 7, 'delivery'); eq(got.insights, 6, 'insights');
});

await test('dependency rule holds', async () => {
  const bad = findViolations(dir);
  if (bad.length) throw new Error(bad.join('; '));
});

// Fixture ----------------------------------------------------------------------------------
let ws, project, run, spec, theme;
await test('fixture inserts', async () => {
  ws = (await one(db, `insert into core.workspaces (name, slug) values ('Demo', 'demo') returning id`)).id;
  await db.query(`insert into core.users (email, display_name) values ('d@example.com', 'D')`);
  project = (await one(db, `insert into core.projects (workspace_id, name) values ($1, 'Clinic booking') returning id`, [ws])).id;
  run = (await one(db, `insert into core.agent_runs (workspace_id, project_id, kind) values ($1, $2, 'spec') returning id`, [ws, project])).id;
  spec = (await one(db, `insert into delivery.specs (workspace_id, project_id, name, agent_run_id) values ($1, $2, 'Spec', $3) returning id`, [ws, project, run])).id;
  const arun = (await one(db, `insert into core.agent_runs (workspace_id, project_id, kind) values ($1, $2, 'analysis') returning id`, [ws, project])).id;
  theme = (await one(db, `insert into research.themes (workspace_id, project_id, run_id, title, category)
    values ($1, $2, $3, 'Price surprises', 'pain_point') returning id`, [ws, project, arun])).id;
});

await test('case-insensitive unique email', async () => {
  await rejects(db, `insert into core.users (email, display_name) values ('D@EXAMPLE.COM', 'Dup')`, [], 'unique');
});

await test('a story needs a spec', async () => {
  await rejects(db, `insert into delivery.stories (workspace_id, key, title) values ($1, 'R1', 'x')`, [ws], 'null');
});

await test('story keys are unique within a spec', async () => {
  await db.query(`insert into delivery.stories (workspace_id, spec_id, key, title) values ($1, $2, 'R1', 'One')`, [ws, spec]);
  await rejects(db, `insert into delivery.stories (workspace_id, spec_id, key, title) values ($1, $2, 'R1', 'Dup')`, [ws, spec], 'unique');
});

await test('new stories start in todo', async () => {
  eq((await one(db, `select status from delivery.stories where key = 'R1'`)).status, 'todo', 'status');
});

await test('effort must be 1 to 3', async () => {
  await rejects(db, `update research.themes set suggested_effort = 4 where id = $1`, [theme], 'check');
});

await test('a spec cannot publish with no steps', async () => {
  await rejects(db, `update delivery.specs set status = 'published' where id = $1`, [spec], 'every step is approved');
});

await test('a spec cannot publish with an unapproved step', async () => {
  await db.query(`insert into core.agent_steps (workspace_id, run_id, position, key, title, status)
    values ($1, $2, 1, 'frame', 'Frame the problem', 'review')`, [ws, run]);
  await rejects(db, `update delivery.specs set status = 'published' where id = $1`, [spec], 'every step is approved');
});

await test('a spec publishes once every step is approved', async () => {
  await db.query(`update core.agent_steps set status = 'approved' where run_id = $1`, [run]);
  await db.query(`update delivery.specs set status = 'published' where id = $1`, [spec]);
  const s = await one(db, `select status, published_at from delivery.specs where id = $1`, [spec]);
  eq(s.status, 'published', 'status');
  if (!s.published_at) throw new Error('published_at not set');
});

await test('updates bump version and updated_at', async () => {
  await db.query(`update core.projects set name = 'Clinic booking v2' where id = $1`, [project]);
  eq((await one(db, `select version from core.projects where id = $1`, [project])).version, 2, 'version');
});

await test('theme_stats counts a participant once across transcripts', async () => {
  const p = (await one(db, `insert into research.participants (workspace_id, project_id, name) values ($1, $2, 'Maya Chen') returning id`, [ws, project])).id;
  const mk = async (name) => (await one(db, `insert into research.transcripts (workspace_id, project_id, name, platform, raw_text, content_hash)
    values ($1, $2, $3, 'zoom', 'x', 'h') returning id`, [ws, project, name])).id;
  const t1 = await mk('S1'), t2 = await mk('S2');
  const sp = async (t, name, role, pid) => (await one(db, `insert into research.transcript_speakers (workspace_id, transcript_id, name, role, participant_id)
    values ($1, $2, $3, $4, $5) returning id`, [ws, t, name, role, pid])).id;
  const a = await sp(t1, 'Maya Chen', 'participant', p), b = await sp(t2, 'Maya Chen', 'participant', p), z = await sp(t2, 'Zed', 'participant', null);
  const mod = await sp(t1, 'Moderator', 'moderator', null);
  const ut = async (t, s, pos) => (await one(db, `insert into research.utterances (workspace_id, transcript_id, speaker_id, position, text)
    values ($1, $2, $3, $4, 'q') returning id`, [ws, t, s, pos])).id;
  const u1 = await ut(t1, a, 1), u2 = await ut(t2, b, 1), u3 = await ut(t2, z, 2); await ut(t1, mod, 2);
  for (const u of [u1, u2, u3]) await db.query(`insert into research.theme_quotes (theme_id, utterance_id, workspace_id) values ($1, $2, $3)`, [theme, u, ws]);
  const st = await one(db, `select mention_count::int m, participant_count::int p, total_participants::int t from research.theme_stats where theme_id = $1`, [theme]);
  eq(st.m, 3, 'mentions'); eq(st.p, 2, 'participants'); eq(st.t, 2, 'total participants (moderator excluded)');
});

await test('a theme belongs to at most one platform theme', async () => {
  const pt = async (title) => (await one(db, `insert into insights.platform_themes (workspace_id, title, category) values ($1, $2, 'pain_point') returning id`, [ws, title])).id;
  const a = await pt('A'), b = await pt('B');
  await db.query(`insert into insights.platform_theme_sources (platform_theme_id, theme_id, workspace_id) values ($1, $2, $3)`, [a, theme, ws]);
  await rejects(db, `insert into insights.platform_theme_sources (platform_theme_id, theme_id, workspace_id) values ($1, $2, $3)`, [b, theme, ws], 'unique');
});

await test('deleting a spec deletes its steps and stories', async () => {
  await db.query(`delete from delivery.specs where id = $1`, [spec]);
  eq((await one(db, `select count(*)::int n from delivery.stories`)).n, 0, 'stories');
  eq((await one(db, `select count(*)::int n from core.agent_steps where run_id = $1`, [run])).n, 0, 'steps');
  eq((await one(db, `select count(*)::int n from core.agent_runs where id = $1`, [run])).n, 0, 'spec run');
});

await test('deleting a project deletes everything under it, including platform sources', async () => {
  const spec2run = (await one(db, `insert into core.agent_runs (workspace_id, project_id, kind) values ($1, $2, 'spec') returning id`, [ws, project])).id;
  await db.query(`insert into delivery.specs (workspace_id, project_id, name, agent_run_id) values ($1, $2, 'S2', $3)`, [ws, project, spec2run]);
  await db.query(`delete from core.projects where id = $1`, [project]);
  for (const t of ['research.themes', 'research.transcripts', 'research.utterances', 'research.theme_quotes',
                   'delivery.specs', 'core.agent_runs', 'insights.platform_theme_sources']) {
    eq((await one(db, `select count(*)::int n from ${t}`)).n, 0, t);
  }
  eq((await one(db, `select count(*)::int n from insights.platform_themes`)).n, 2, 'platform themes remain');
});

await test('audit_log survives deletes (no foreign keys on the entity)', async () => {
  await db.query(`insert into core.audit_log (workspace_id, entity, entity_id, verb) values ($1, 'core.projects', gen_random_uuid(), 'deleted')`, [ws]);
});

await test('migrations roll back and re-apply cleanly', async () => {
  await down(db);
  const { rows } = await db.query(`select count(*)::int n from information_schema.schemata where schema_name in ('core','research','delivery','insights')`);
  eq(rows[0].n, 0, 'schemas left after rollback');
  await up(db);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
