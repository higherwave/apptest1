// Tests the demo seed against an in-memory Postgres (PGlite). Uses no Neon compute.
//   npm run test:seed
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { migrationFiles } from './migrate.mjs';
import { seed, uid, DEMO_SLUG } from './seed/seed.mjs';

const here = dirname(fileURLToPath(import.meta.url));
let passed = 0;
const failures = [];
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failures.push(name); console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const rows = async (db, sql, params) => (await db.query(sql, params)).rows;
const val = async (db, sql, params) => Object.values((await rows(db, sql, params))[0])[0];

const db = new PGlite();
for (const f of migrationFiles()) await db.exec(readFileSync(join(here, 'migrations', f), 'utf8'));
console.log('Demo seed tests');

let summary;
await test('seed loads in one go', async () => { summary = await seed(db); });

await test('row counts', async () => {
  eq(summary['core.projects'], 4, 'projects');
  eq(summary['research.participants'], 15, 'participants');
  eq(summary['research.transcripts'], 3 + 4 + 6, 'transcripts');
  eq(summary['delivery.specs'], 1, 'specs');
  eq(summary['delivery.stories'], 10, 'stories');
  eq(summary['insights.platform_themes'], 5, 'platform themes');
  eq(summary['insights.recommendations'], 4, 'recommendations');
  eq(summary['insights.case_studies'], 4, 'case studies');
});

await test('project 1 reproduces the prototype analysis: 9 themes in the same order', async () => {
  const r = await rows(db, `select t.title, t.suggested_priority p, t.suggested_effort e, s.participant_count::int ppl, s.total_participants::int total, s.mention_count::int m
    from research.themes t join research.theme_stats s on s.theme_id = t.id
    where t.project_id = $1 order by t.score desc, t.title`, [uid('project:p1')]);
  eq(r.length, 9, 'theme count');
  // Prototype output (checked against the prototype's own analyze()): id | ppl | total | mentions | priority | effort
  const expected = [['Insurance coverage is unclear up front', 3, 3, 3, 'high', 3], ['Reminders build confidence', 3, 3, 3, 'high', 1],
    ['Provider availability is hard to see', 3, 3, 3, 'high', 3], ['Rescheduling forces a phone call', 3, 3, 3, 'high', 2],
    ['Booking form repeats questions', 3, 3, 3, 'high', 2], ['Price surprises at confirmation', 2, 3, 2, 'high', 2],
    ['Follow-up instructions get lost', 2, 3, 2, 'medium', 2], ['Reviews and ratings drive trust', 2, 3, 2, 'medium', 1],
    ['Wants to know what to prepare', 2, 3, 2, 'medium', 1]];
  eq(r.map((x) => [x.title, x.ppl, x.total, x.m, x.p, x.e]), expected, 'themes');
});

await test('cards use tint names, never hex', async () => {
  eq(await rows(db, `select name, color from core.projects order by name`), [{ name: 'Check-in diary study', color: 'lavender' }, { name: 'Clinic booking, round 2', color: 'mint' }, { name: 'Clinic booking, usability round 1', color: 'cream' }, { name: 'New patient intake (draft)', color: 'coral' }], 'project colours');
  eq(await val(db, `select count(*)::int from insights.case_studies where color like '#%'`), 0, 'hex left in case studies');
  try { await db.query(`update core.projects set color = '#ffffff'`); throw new Error('hex was accepted'); } catch (e) { if (e.message === 'hex was accepted') throw e; }
});

await test('project 4 is a draft: a plan and no transcripts or themes', async () => {
  eq(await val(db, `select count(*)::int from research.transcripts where project_id = $1`, [uid('project:p4')]), 0, 'transcripts');
  eq(await val(db, `select count(*)::int from research.themes where project_id = $1`, [uid('project:p4')]), 0, 'themes');
  eq(await val(db, `select count(*)::int from research.tasks where project_id = $1`, [uid('project:p4')]) > 0, true, 'has tasks');
});

await test('participants: 3 + 4 + 6 = 13 speakers across analysed projects', async () => {
  const n = await val(db, `select count(distinct coalesce(s.participant_id::text, 'sp:' || lower(s.name)))::int from research.transcript_speakers s where s.role = 'participant'`);
  eq(n, 13, 'distinct participants');
  eq(await val(db, `select count(distinct project_id)::int from research.themes`), 3, 'analysed projects');
});

await test('the board is published, with 8 approved steps and a redo recorded', async () => {
  const s = await rows(db, `select status, published_at is not null as has_date from delivery.specs`);
  eq(s, [{ status: 'published', has_date: true }], 'spec');
  const steps = await rows(db, `select position, key, status, revision from core.agent_steps where run_id = $1 order by position`, [uid('run:spec:p1')]);
  eq(steps.length, 8, 'steps'); eq([...new Set(steps.map((x) => x.status))], ['approved'], 'status');
  eq(steps.find((x) => x.key === 'scope').revision, 1, 'redo revision');
  eq(await val(db, `select count(*)::int from delivery.spec_step_evidence`) > 0, true, 'evidence');
});

await test('stories: 10 cards in the right columns, all with a theme link except the fee policy', async () => {
  const c = await rows(db, `select status, count(*)::int n from delivery.stories group by 1 order by 1`);
  eq(c.map((x) => [x.status, x.n]), [['todo', 5], ['in_progress', 3], ['in_review', 1], ['done', 1]], 'columns (enum order)');
  const unlinked = await rows(db, `select key from delivery.stories where theme_id is null`);
  eq(unlinked, [{ key: 'Q3' }], 'stories without a theme');
  eq(await val(db, `select count(*)::int from delivery.stories where kind = 'open_question'`), 3, 'open questions');
  eq(await val(db, `select count(*)::int from delivery.requirements`), 7, 'requirements');
});

await test('board progress: R3 has both criteria and tasks, and some criteria are met', async () => {
  const r = await rows(db, `select c.kind, count(*)::int n, sum(c.met::int)::int met from delivery.story_checklist c join delivery.stories s on s.id = c.story_id where s.key = 'R3' group by c.kind order by c.kind`);
  eq(r.length, 2, 'kinds');
  eq(r.find((x) => x.kind === 'criterion').met > 0, true, 'some criteria met');
});

await test('theme links on stories point at the right themes', async () => {
  const r = await rows(db, `select s.key, t.title from delivery.stories s join research.themes t on t.id = s.theme_id where s.key in ('R2', 'Q1', 'Q2') order by s.key`);
  eq(r, [{ key: 'Q1', title: 'Provider availability is hard to see' }, { key: 'Q2', title: 'Insurance coverage is unclear up front' }, { key: 'R2', title: 'Rescheduling forces a phone call' }], 'links');
});

await test('Insights groups themes by the simulated matcher; unrelated themes stay unmatched', async () => {
  const r = await rows(db, `select pt.title, count(*)::int n, bool_or(s.match_method = 'manual') as has_manual
    from insights.platform_theme_sources s join insights.platform_themes pt on pt.id = s.platform_theme_id group by pt.title order by pt.title`);
  const byTitle = Object.fromEntries(r.map((x) => [x.title, x.n]));
  eq(byTitle['Provider availability is hard to see'], 3, 'availability across 3 projects');
  eq(byTitle['Insurance coverage is unclear up front'], 2, 'insurance (project 1 and 2)');
  eq(r.find((x) => x.title === 'A prep checklist before the visit is valued').has_manual, true, 'one manual tag');
  const unmatched = await rows(db, `select t.title from research.themes t left join insights.platform_theme_sources s on s.theme_id = t.id where s.theme_id is null order by 1`);
  eq(unmatched.map((x) => x.title), ['Booking form repeats questions', 'Follow-up instructions get lost', 'Reviews and ratings drive trust'], 'unmatched');
});

await test('Insights counts derive from quotes: availability reaches 3 + 3 + 5 = 11 of 13', async () => {
  const n = await val(db, `select sum(st.participant_count)::int from insights.platform_theme_sources s join research.theme_stats st on st.theme_id = s.theme_id
    join insights.platform_themes pt on pt.id = s.platform_theme_id where pt.title = 'Provider availability is hard to see'`);
  eq(n, 11, 'availability participants');
});

await test('platform stats count distinct people: prep checklist is 10 of 13, not 12', async () => {
  const r = await rows(db, `select pt.title, st.participant_count::int people, st.project_count::int projects
    from insights.platform_theme_stats st join insights.platform_themes pt on pt.id = st.platform_theme_id order by people desc, pt.title`);
  eq(r.map((x) => [x.title, x.people, x.projects]), [
    ['Provider availability is hard to see', 11, 3], ['A prep checklist before the visit is valued', 10, 3],
    ['People expect to reschedule without calling', 10, 3], ['Insurance coverage is unclear up front', 6, 2], ['Fees appear late at checkout', 4, 2]], 'platform theme stats');
  const w = await rows(db, `select project_count::int p, participant_count::int n from insights.workspace_stats`);
  eq(w, [{ p: 3, n: 13 }], 'workspace denominators (draft project excluded)');
});

await test('job-to-be-done fields hold bare phrases, so generated text reads "I want to find", not "I want to to find"', async () => {
  const r = await rows(db, `select jtbd_want w, jtbd_so s from research.studies`);
  for (const x of r) { if (/^to /i.test(x.w || '') || /^i can /i.test(x.s || '')) throw new Error(`connective words repeated in: ${JSON.stringify(x)}`); }
  const text = await val(db, `select reasoning from core.agent_steps where key = 'users_jobs'`);
  if (/to to /.test(text) || /I can I can/.test(text)) throw new Error('generated text repeats words: ' + text.slice(0, 200));
  if (!/I want to find an available/.test(text)) throw new Error('expected the composed sentence in: ' + text.slice(0, 200));
});

await test('ids are deterministic and a second seed gives the same result', async () => {
  const before = await rows(db, `select id from delivery.stories order by id`);
  const again = await seed(db);
  eq(again, summary, 'counts after reseed');
  eq(await rows(db, `select id from delivery.stories order by id`), before, 'story ids');
});

await test('reseeding touches only the demo workspace', async () => {
  const other = (await db.query(`insert into core.workspaces (name, slug) values ('Other', 'other') returning id`)).rows[0].id;
  await db.query(`insert into core.projects (workspace_id, name) values ($1, 'Keep me')`, [other]);
  await seed(db);
  eq(await val(db, `select count(*)::int from core.projects where workspace_id = $1`, [other]), 1, 'other workspace kept');
  eq(await val(db, `select count(*)::int from core.workspaces where slug = $1`, [DEMO_SLUG]), 1, 'one demo workspace');
});

console.log(`\n${passed} passed, ${failures.length} failed`);
process.exit(failures.length ? 1 : 0);
