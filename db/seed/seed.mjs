// Loads the demo workspace: 4 projects, transcripts, analysed themes, one published board, and the
// Platform Insights rows. Built from the prototype's own sample data (db/seed/data/*.json), so the
// database reproduces what the prototype shows. Everything is deterministic: ids are derived from
// names, so deep links and tests stay stable across resets.
//
//   node seed/seed.mjs            show what exists and what would change (read-only)
//   node seed/seed.mjs --yes      reset the demo workspace and reload it, in one transaction
//
// Only the workspace with slug "higherwave-demo" and users at @demo.signalflow.example are touched.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { analyze, buildSteps, matchThemes, parseTranscript, scoreTheme } from '../../shared/providers.mjs';
import { PLATFORM_KEYWORDS } from '../../shared/platform-keywords.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const json = (f) => JSON.parse(readFileSync(join(here, 'data', f), 'utf8'));
const R = json('research.json');
const B = json('boards.json');
const I = json('platformInsights.json');

export const DEMO_SLUG = 'higherwave-demo';
export const DEMO_DOMAIN = 'demo.signalflow.example';

// Helpers ------------------------------------------------------------------------------------

export function uid(key) {
  const h = createHash('sha1').update('signalflow-demo:' + key).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
// The analysis is identified by the transcripts it read: names and content hashes, in order. The API computes the
// same fingerprint (server/transcripts.ts), so a seeded project is not flagged as out of date.
const sha = (s) => createHash('sha256').update(s).digest('hex');
const catEnum = { 'Pain point': 'pain_point', Need: 'need', Expectation: 'expectation', Delight: 'delight' };
const platEnum = { Zoom: 'zoom', Meet: 'meet', Teams: 'teams' };
const lower = (s) => String(s).toLowerCase();
// The prototype's pastel fills, by the tint token that replaces each hex (see src/theme.scss).
const TINT = { '#faf3e6': 'cream', '#e4f3ec': 'mint', '#fbf3cf': 'yellow', '#fbe9e0': 'coral', '#eeeafa': 'lavender', '#e6f2fa': 'sky', '#eef2fa': 'blue', '#fae6ed': 'rose', '#fddcc6': 'peach', '#faf1df': 'sand' };

async function insert(db, table, rows) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const params = [];
  const tuples = rows.map((r) => '(' + cols.map((c) => {
    let v = r[c] === undefined ? null : r[c];
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) v = JSON.stringify(v);
    params.push(v);
    return '$' + params.length;
  }).join(',') + ')');
  await db.query(`insert into ${table} (${cols.join(',')}) values ${tuples.join(',')}`, params);
}

// Demo content -------------------------------------------------------------------------------

const USERS = [
  { key: 'david', email: `david@${DEMO_DOMAIN}`, name: 'David Garrett', role: 'owner' },
  { key: 'alex', email: `alex@${DEMO_DOMAIN}`, name: 'Alex Rivera', role: 'editor' },
  { key: 'sam', email: `sam@${DEMO_DOMAIN}`, name: 'Sam Patel', role: 'viewer' },
];

// Job-to-be-done fields hold the bare phrase that follows "I want to" and "so I can". The prototype's sample data
// repeated those words inside the values, which made its generated text read "I want to to find".
const SAMPLE_PARTICIPANTS = [
  { name: 'Maya Chen', role: 'Working parent, new patient', date: '2026-10-06' },
  { name: 'Daniel Ortiz', role: 'Shift worker, returning patient', date: '2026-10-07' },
  { name: 'Priya Nair', role: 'Graduate student, new patient', date: '2026-10-08' },
];
const ROUND2 = [
  { name: 'Jordan Lee', role: 'Working parent, returning patient', date: '2026-10-13' },
  { name: 'Amira Hassan', role: 'Student, new patient', date: '2026-10-14' },
  { name: 'Chris Park', role: 'Retired, returning patient', date: '2026-10-15' },
  { name: 'Elena Rossi', role: 'Shift worker, new patient', date: '2026-10-16' },
];
const DIARY = [
  { name: 'Noah Kim', role: 'Caregiver' }, { name: 'Fatima Ali', role: 'Working parent' },
  { name: 'Luis Mendez', role: 'Shift worker' }, { name: 'Grace Okafor', role: 'Graduate student' },
  { name: 'Tomas Novak', role: 'Retired' }, { name: 'Yuki Tanaka', role: 'Remote worker' },
].map((p, i) => ({ ...p, date: `2026-10-${String(12 + i).padStart(2, '0')}` }));
const INTAKE = [
  { name: 'Riley Brooks', role: 'New patient', date: null },
  { name: 'Morgan Diaz', role: 'Returning patient', date: null },
];

const PROJECTS = [
  { key: 'p1', name: 'Clinic booking, usability round 1', color: 'cream', tpl: 'usability', participants: SAMPLE_PARTICIPANTS,
    study: { what: 'Whether patients can find a provider, book, and manage an appointment without calling the clinic',
      jWhen: 'I need to see a doctor soon', jWant: 'find an available, covered provider and book quickly', jSo: 'plan my day around the visit',
      outcomes: ['Task completion rate above 80%', 'Top barriers ranked by severity'], methods: ['Moderated usability test', 'Survey follow-up'] } },
  { key: 'p2', name: 'Clinic booking, round 2', color: 'mint', tpl: 'usability', participants: ROUND2, platforms: ['zoom', 'meet', 'teams', 'zoom'],
    synth: { counts: { 0: 3, 1: 3, 2: 4, 3: 3, 4: 2 }, offset: 1 },
    study: { what: 'Whether the changes from round 1 let patients find a provider, book and reschedule without calling the clinic',
      jWhen: 'I need to move an appointment', jWant: 'change it in the app without calling', jSo: 'keep my day on track',
      outcomes: ['Fewer calls to the clinic', 'Reschedule completed in the app'], methods: ['Moderated usability test'] } },
  { key: 'p3', name: 'Check-in diary study', color: 'lavender', tpl: 'discovery', participants: DIARY,
    synth: { counts: { 0: 5, 2: 3, 3: 4 }, offset: 2, diary: true },
    study: { what: 'How patients prepare for, travel to and follow up on a visit over a week',
      jWhen: 'I have an appointment coming up', jWant: 'know what to bring and when to leave', jSo: 'arrive prepared',
      outcomes: ['Map of current workflow', 'Top unmet needs'], methods: ['Diary study'] } },
  { key: 'p4', name: 'New patient intake (draft)', color: 'coral', tpl: 'concept', participants: INTAKE, draft: true,
    study: { what: R.TEMPLATES.concept.what, jWhen: null, jWant: null, jSo: null, outcomes: R.TEMPLATES.concept.outcomes, methods: R.TEMPLATES.concept.methods } },
];

// Platform theme index (Insights data order) -> prototype theme id used for the synthetic projects.
const PLATFORM_THEME_DEF = ['t1', 't2', 't8', 't6', 't5'];
const EXTRA_QUOTES = [
  ['There is no way to see everyone’s open times in one place.', 'I only get slots after I tap into each provider, which takes forever.', 'Availability is buried, so I pick whoever I can find a time with.', 'I work shifts, so I need to see open slots across providers at once.'],
  ['The copay estimate is nowhere until the last step.'],
  ['I had to call the office and wait on hold just to move my visit.', 'Cancelling should not need a phone call during office hours.'],
  ['A checklist before the visit would have saved me a second trip.', 'The text reminder the day before is why I did not forget.', 'I like knowing what paperwork to bring ahead of time.'],
  ['The total at checkout was higher than the listing.'],
];

// Board content: which theme each demo story comes from (null: not theme-derived).
const STORY_THEME = { r1: 't4', r2: 't8', r3: 't5', r4: 't6', r5: 't7', r6: 't9', r7: 't3', 'q-avail': 't1', 'q-ins': 't2', 'q-fees': null };
const SPEC_STEP_KEYS = ['frame_problem', 'users_jobs', 'goals_metrics', 'scope', 'requirements', 'risks_dependencies', 'rollout', 'open_questions'];
const REDO_STEP = { index: 3, note: 'Focus on the new-patient flow' };

function monthToDate(label) {
  const m = String(label).match(/^([A-Za-z]{3}) (\d{4})$/);
  if (!m) return null;
  const mo = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].toLowerCase());
  return mo < 0 ? null : `${m[2]}-${String(mo + 1).padStart(2, '0')}-01`;
}
const clock = (sec) => `00:${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

// Synthetic transcripts for projects 2 and 3 --------------------------------------------------
// Each platform theme gets one quote from n distinct participants, taken from the prototype's
// Insights quotes first and from a short extra pool after, so counts match the Insights data.
function syntheticTranscripts(proj, firstTask) {
  const { counts, offset, diary } = proj.synth;
  const N = proj.participants.length;
  const pool = (k) => {
    const real = I.T[k].src.flatMap((s) => s.q.map((q) => q.x));
    return [...new Set([...real, ...EXTRA_QUOTES[k]])];
  };
  const perPerson = proj.participants.map(() => []);
  const assignments = {}; // themeIdx -> [{ person, text }]
  Object.entries(counts).forEach(([ks, n]) => {
    const k = Number(ks);
    const quotes = pool(k);
    assignments[k] = Array.from({ length: n }, (_, i) => {
      const person = (offset + k + i) % N;
      const text = quotes[(offset + i) % quotes.length];
      perPerson[person].push(text);
      return { person, text };
    });
  });
  const transcripts = proj.participants.map((p, i) => {
    const lines = diary ? [] : [`${clock(5)} Moderator: ${firstTask}`];
    perPerson[i].forEach((text, j) => lines.push(`${clock(60 + 75 * j)} ${p.name}: ${text}`));
    return {
      name: diary ? `Diary - ${p.name}.txt` : `Session ${i + 1} - ${p.name}.txt`,
      platform: diary ? null : proj.platforms[i],
      text: lines.join('\n'),
    };
  });
  return { transcripts, assignments };
}

// Main ---------------------------------------------------------------------------------------

export async function seed(db) {
  const q = (sql, params) => db.query(sql, params);
  const WS = uid('workspace');

  // Reset only the demo workspace and demo users. Cascades remove everything under them.
  await q('delete from core.workspaces where slug = $1', [DEMO_SLUG]);
  await q('delete from core.users where email like $1', ['%@' + DEMO_DOMAIN]);

  await insert(db, 'core.workspaces', [{ id: WS, name: 'Higherwave Demo', slug: DEMO_SLUG }]);
  await insert(db, 'core.users', USERS.map((u) => ({ id: uid('user:' + u.key), email: u.email, display_name: u.name })));
  await insert(db, 'core.memberships', USERS.map((u) => ({ id: uid('member:' + u.key), workspace_id: WS, user_id: uid('user:' + u.key), role: u.role })));
  const DAVID = uid('user:david');

  await insert(db, 'core.templates', Object.entries(R.TEMPLATES).map(([key, t]) => ({
    id: uid('template:' + key), workspace_id: WS, kind: 'study', key, name: t.name, description: t.desc,
    body: { what: t.what, jWhen: t.jWhen, jWant: t.jWant, jSo: t.jSo, outcomes: t.outcomes, methods: t.methods, tasks: t.tasks },
  })));

  const built = {}; // per project: themes with ids, for later steps

  for (const proj of PROJECTS) {
    const P = uid('project:' + proj.key);
    const tpl = R.TEMPLATES[proj.tpl];
    await insert(db, 'core.projects', [{ id: P, workspace_id: WS, name: proj.name, color: proj.color, kind: 'research', template_id: uid('template:' + proj.tpl), owner_id: DAVID, created_by: DAVID }]);
    await insert(db, 'research.studies', [{ project_id: P, workspace_id: WS, what_testing: proj.study.what, jtbd_when: proj.study.jWhen, jtbd_want: proj.study.jWant, jtbd_so: proj.study.jSo, outcomes: proj.study.outcomes, methods: proj.study.methods }]);
    await insert(db, 'research.study_stages', R.STAGES.map((name, i) => ({ id: uid(`stage:${proj.key}:${i}`), workspace_id: WS, study_id: P, position: i, name })));
    await insert(db, 'research.participants', proj.participants.map((p, i) => ({
      id: uid(`part:${proj.key}:${i}`), workspace_id: WS, project_id: P, name: p.name, role: p.role,
      email: p.name.toLowerCase().replace(/[^a-z ]/g, '').replace(/ /g, '.') + '@example.com', session_date: p.date, position: i,
    })));
    const taskRows = [], followRows = [];
    tpl.tasks.forEach((t, i) => {
      taskRows.push({ id: uid(`task:${proj.key}:${i}`), workspace_id: WS, project_id: P, position: i, prompt: t.q });
      t.fups.forEach((f, j) => followRows.push({ id: uid(`task:${proj.key}:${i}:${j}`), workspace_id: WS, project_id: P, parent_task_id: uid(`task:${proj.key}:${i}`), position: j, prompt: f }));
    });
    await insert(db, 'research.tasks', taskRows);
    await insert(db, 'research.tasks', followRows);

    if (proj.draft) { built[proj.key] = { themes: [] }; continue; } // plan only: shows the "Draft" status

    // Transcripts -> speakers -> utterances
    let transcripts, assignments = null;
    if (proj.key === 'p1') transcripts = R.SAMPLES.map((s) => ({ name: s.name, platform: platEnum[s.platform], text: s.text }));
    else ({ transcripts, assignments } = syntheticTranscripts(proj, tpl.tasks[0].q));

    const parsed = transcripts.map((t) => parseTranscript(t.text));
    const pIndex = (who) => proj.participants.findIndex((p) => p.name.toLowerCase() === who.toLowerCase());
    const trRows = [], spkRows = [], uttRows = [];
    transcripts.forEach((t, ti) => {
      const TR = uid(`transcript:${proj.key}:${ti}`);
      trRows.push({ id: TR, workspace_id: WS, project_id: P, position: ti, name: t.name, platform: t.platform, raw_text: t.text, content_hash: sha(t.text) });
      const seen = new Set();
      parsed[ti].forEach((l, ui) => {
        const sk = lower(l.who);
        if (!seen.has(sk)) {
          seen.add(sk);
          const pi = l.mod ? -1 : pIndex(l.who);
          spkRows.push({ id: uid(`spk:${proj.key}:${ti}:${sk}`), workspace_id: WS, transcript_id: TR, name: l.who, role: l.mod ? 'moderator' : 'participant', participant_id: pi >= 0 ? uid(`part:${proj.key}:${pi}`) : null });
        }
        uttRows.push({ id: uid(`utt:${proj.key}:${ti}:${ui + 1}`), workspace_id: WS, transcript_id: TR, speaker_id: uid(`spk:${proj.key}:${ti}:${sk}`), position: ui + 1, timestamp_label: l.ts, text: l.text });
      });
    });
    await insert(db, 'research.transcripts', trRows);
    await insert(db, 'research.transcript_speakers', spkRows);
    await insert(db, 'research.utterances', uttRows);

    // Analysis run (simulated) and its themes
    const RUN = uid('run:analysis:' + proj.key);
    await insert(db, 'core.agent_runs', [{ id: RUN, workspace_id: WS, project_id: P, kind: 'analysis', status: 'complete', input_hash: sha(transcripts.map((t) => `${t.name}:${sha(t.text)}`).join('|')), provider: 'stub', prompt_version: 'keyword-v1', finished_at: new Date() }]);
    await insert(db, 'core.agent_steps', R.BUSY.map((title, i) => ({ id: uid(`step:analysis:${proj.key}:${i}`), workspace_id: WS, run_id: RUN, position: i + 1, key: lower(title).replace(/[^a-z]+/g, '_'), title, status: 'approved' })));

    let themes; // { id, def, quotes: [{ t, u, text }], ppl, total, mentions, score, prio, eff, effNote }
    if (proj.key === 'p1') {
      themes = analyze(transcripts, proj.participants, R.TH, R.EFF);
    } else {
      const total = proj.participants.length;
      themes = Object.entries(assignments).map(([ks, list]) => {
        const def = R.TH.find((d) => d.id === PLATFORM_THEME_DEF[Number(ks)]);
        const quotes = list.map(({ person, text }) => {
          const name = proj.participants[person].name;
          const ti = transcripts.findIndex((t) => t.name.includes(name));
          const u = parsed[ti].findIndex((l) => l.who === name && l.text === text);
          return { t: ti, u, who: name, text };
        });
        const ppl = new Set(quotes.map((x) => x.who)).size;
        const { score, prio } = scoreTheme({ ppl, total, mentions: quotes.length, sev: def.sev });
        const ef = R.EFF[def.id] || [2, 'Effort not yet estimated.'];
        return { ...def, quotes, ppl, total, mentions: quotes.length, score, prio, eff: ef[0], effNote: ef[1] };
      }).sort((a, b) => b.score - a.score);
    }
    themes.forEach((th) => { th.dbId = uid(`theme:${proj.key}:${th.id}`); });

    await insert(db, 'research.themes', themes.map((th) => ({
      id: th.dbId, workspace_id: WS, project_id: P, run_id: RUN, title: th.title, category: catEnum[th.cat], stage_position: th.stage, severity: th.sev,
      description: th.desc, opportunity: th.opp, suggested_priority: lower(th.prio), suggested_effort: th.eff, effort_note: th.effNote, score: Number(th.score.toFixed(4)),
    })));
    await insert(db, 'research.theme_quotes', themes.flatMap((th) => th.quotes.map((qt) => ({ theme_id: th.dbId, utterance_id: uid(`utt:${proj.key}:${qt.t}:${qt.u + 1}`), workspace_id: WS }))));

    // Demo edits on project 1: five pinned themes on the journey map and one priority/effort edit.
    if (proj.key === 'p1') {
      const pinned = new Set(['t2', 't6', 't1', 't8', 't4', 't7']);
      await insert(db, 'research.theme_overrides', themes.filter((th) => pinned.has(th.id)).map((th) => ({
        theme_id: th.dbId, workspace_id: WS, pinned: true, priority: th.id === 't7' ? 'high' : null, effort: th.id === 't7' ? 2 : null,
      })));
    }
    built[proj.key] = { P, themes, transcripts };
  }

  // Published requirements document and board for project 1 -----------------------------------
  {
    const proj = PROJECTS[0], P = uid('project:p1'), { themes } = built.p1;
    const byId = Object.fromEntries(themes.map((t) => [t.id, t]));
    const RUN = uid('run:spec:p1'), SPEC = uid('spec:p1');
    await insert(db, 'core.agent_runs', [{ id: RUN, workspace_id: WS, project_id: P, kind: 'spec', status: 'complete', provider: 'stub', prompt_version: 'spec-steps-v1', finished_at: new Date() }]);
    await insert(db, 'delivery.specs', [{ id: SPEC, workspace_id: WS, project_id: P, name: proj.name, agent_run_id: RUN, status: 'draft', created_by: DAVID }]);
    await insert(db, 'delivery.spec_themes', themes.map((t) => ({ spec_id: SPEC, theme_id: t.dbId, workspace_id: WS, included: true })));

    const ctx = {
      what: proj.study.what, jtbd: [proj.study.jWhen, proj.study.jWant, proj.study.jSo], outcomes: proj.study.outcomes,
      people: proj.participants.map((p) => p.role), sessions: proj.participants.length,
      themes: themes.map((t) => ({ id: t.id, title: t.title, cat: t.cat, prio: t.prio, ppl: t.ppl, total: t.total, eff: t.eff, opp: t.opp, quote: t.quotes[0].text })),
    };
    const steps = buildSteps(ctx, Object.fromEntries(themes.map((t) => [t.id, true])));

    // Keep the "Draft requirements" step in step with the board's R-numbers.
    const reqStories = B.defaultData.filter((s) => s.id.startsWith('r')).sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
    steps[4].out = ['Requirements', reqStories.map((s) => {
      const t = byId[STORY_THEME[s.id]];
      return `${s.id.toUpperCase()}: ${t.opp} (${t.ppl} of ${t.total} participants)`;
    })];

    const stepRows = [], altRows = [], evRows = [];
    steps.forEach((s, i) => {
      const STEP = uid(`step:spec:p1:${i}`);
      const redo = i === REDO_STEP.index;
      const [heading, second, third] = s.out;
      stepRows.push({
        id: STEP, workspace_id: WS, run_id: RUN, position: i + 1, key: SPEC_STEP_KEYS[i], title: s.t,
        reasoning: s.r + (redo ? ` Revised to account for: ${REDO_STEP.note}.` : ''), status: 'approved',
        redo_note: redo ? REDO_STEP.note : null, revision: redo ? 1 : 0,
        output: { heading, text: Array.isArray(second) ? null : second || null, items: Array.isArray(second) ? second : third || null },
        approved_by: DAVID, approved_at: new Date(),
      });
      s.alts.forEach((a, j) => altRows.push({ id: uid(`alt:spec:p1:${i}:${j}`), workspace_id: WS, step_id: STEP, position: j, title: a.title, reason: a.reason }));
      s.ev.forEach((e) => {
        const t = themes.find((x) => x.title === e.split(' · ')[0]);
        if (t) evRows.push({ step_id: STEP, theme_id: t.dbId, workspace_id: WS });
      });
    });
    await insert(db, 'core.agent_steps', stepRows);
    await insert(db, 'core.agent_step_alternatives', altRows);
    await insert(db, 'delivery.spec_step_evidence', evRows);

    // Requirements (snapshots) and stories from the prototype's board
    const reqRows = [], storyRows = [], checkRows = [];
    const perStatus = {};
    let qn = 0;
    B.defaultData.forEach((s) => {
      const isQ = s.kind === 'open_question';
      const key = isQ ? `Q${++qn}` : s.id.toUpperCase();
      const theme = STORY_THEME[s.id] ? byId[STORY_THEME[s.id]] : null;
      const REQ = !isQ ? uid('req:' + s.id) : null;
      if (!isQ) {
        reqRows.push({ id: REQ, workspace_id: WS, spec_id: SPEC, theme_id: theme.dbId, title: s.name.replace(/^R\d+ — /, ''), category: catEnum[theme.cat], priority: lower(s.priority), effort: theme.eff, opportunity: theme.opp, supporting_quote: theme.quotes[0].text });
      }
      perStatus[s.status] = (perStatus[s.status] || 0) + 1;
      const STORY = uid('story:' + s.id);
      storyRows.push({
        id: STORY, workspace_id: WS, spec_id: SPEC, requirement_id: REQ, theme_id: theme ? theme.dbId : null, kind: s.kind, key,
        title: s.name.replace(/^R\d+ — /, '').replace(/^Open question — /, ''), status: s.status, position: perStatus[s.status] * 1000,
        priority: lower(s.priority), owner_team: s.owner, summary: s.short, why_it_matters: s.why, next_step: s.nextStep,
      });
      s.criteria.forEach((c, i) => checkRows.push({ id: uid(`check:${s.id}:${i}`), workspace_id: WS, story_id: STORY, kind: c.kind, text: c.text, met: c.met, position: i }));
    });
    await insert(db, 'delivery.requirements', reqRows);
    await insert(db, 'delivery.stories', storyRows);
    await insert(db, 'delivery.story_checklist', checkRows);

    // Every step is approved, so the publish rule allows this.
    await q(`update delivery.specs set status = 'published' where id = $1`, [SPEC]);
  }

  // Platform Insights: themes across every analysed project ------------------------------------
  {
    const PT = I.T.map((t, i) => ({ id: uid('pt:' + i), title: t.title, cat: t.cat, keywords: PLATFORM_KEYWORDS[t.title] }));
    await insert(db, 'insights.platform_themes', PT.map((p) => ({ id: p.id, workspace_id: WS, title: p.title, category: catEnum[p.cat], position: PT.indexOf(p) })));

    const all = ['p1', 'p2', 'p3'].flatMap((k) => built[k].themes.map((t) => ({ id: t.dbId, ref: `${k}:${t.id}`, title: t.title, description: t.desc, opportunity: t.opp })));
    const matches = new Map(matchThemes(all, PT).map((m) => [m.themeId, { ...m, method: 'auto' }]));
    // One theme confirmed by hand, to show a manual tag next to the automatic ones.
    const manual = all.find((t) => t.ref === 'p1:t7');
    if (manual) matches.set(manual.id, { themeId: manual.id, platformThemeId: PT[3].id, confidence: null, method: 'manual' });
    await insert(db, 'insights.platform_theme_sources', [...matches.values()].map((m) => ({
      platform_theme_id: m.platformThemeId, theme_id: m.themeId, workspace_id: WS, match_method: m.method, confidence: m.confidence === null ? null : Number(m.confidence.toFixed(2)),
    })));

    await insert(db, 'insights.recommendations', I.R.map((r, i) => ({ id: uid('rec:' + i), workspace_id: WS, title: r.title, why: r.why, priority: lower(r.prio), position: i })));
    await insert(db, 'insights.recommendation_themes', I.R.flatMap((r, i) => r.th.map((k) => ({ recommendation_id: uid('rec:' + i), platform_theme_id: PT[k].id, workspace_id: WS }))));
    await insert(db, 'insights.case_studies', I.C.map((c, i) => ({ id: uid('case:' + i), workspace_id: WS, title: c.title, summary: c.summary, outcome: c.outcome, owner_team: c.owner, occurred_on: monthToDate(c.date), color: TINT[c.bg.toLowerCase()] || 'cream' })));
    await insert(db, 'insights.case_study_themes', I.C.flatMap((c, i) => c.th.map((k) => ({ case_study_id: uid('case:' + i), platform_theme_id: PT[k].id, workspace_id: WS }))));
  }

  return summarize(db);
}

export async function summarize(db) {
  const tables = ['core.projects', 'research.participants', 'research.transcripts', 'research.utterances', 'research.themes', 'research.theme_quotes',
    'delivery.specs', 'delivery.requirements', 'delivery.stories', 'delivery.story_checklist', 'insights.platform_themes', 'insights.platform_theme_sources',
    'insights.recommendations', 'insights.case_studies'];
  const out = {};
  for (const t of tables) out[t] = Number((await db.query(`select count(*)::int n from ${t}`)).rows[0].n);
  return out;
}

// CLI ----------------------------------------------------------------------------------------

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
    const existing = await client.query('select id from core.workspaces where slug = $1', [DEMO_SLUG]);
    console.log(existing.rows.length ? `The demo workspace exists and will be deleted and reloaded.` : 'No demo workspace yet; it will be created.');
    console.log(`Touches only: workspace "${DEMO_SLUG}" and users @${DEMO_DOMAIN}.`);
    if (!yes) { console.log('\nDry run. Re-run with --yes to load the demo data.'); process.exit(0); }
    await client.query('begin');
    try {
      const summary = await seed(client);
      await client.query('commit');
      console.log('\nLoaded:');
      for (const [k, v] of Object.entries(summary)) console.log(`  ${k.padEnd(34)} ${v}`);
    } catch (e) {
      await client.query('rollback');
      throw new Error('Seed failed and was rolled back: ' + e.message);
    }
  } finally {
    await client.end();
  }
}
