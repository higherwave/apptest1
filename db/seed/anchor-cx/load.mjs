// Loads the Anchor CX demo story into an existing workspace, next to whatever is already there (nothing else is touched or deleted).
// Safe to run again: it removes its own earlier rows first, found by their fixed ids. See README.md in this folder for the story.
//
//   node db/seed/anchor-cx.mjs            show what would happen (read-only)
//   node db/seed/anchor-cx.mjs --yes      load it into the demo workspace, in one transaction
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { parseTranscript, scoreTheme } from '../../../shared/providers.mjs';
import { reviewersFor, stepLabel } from '../../../shared/launch.mjs';
import * as D from './data.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const sha = (s) => createHash('sha256').update(s).digest('hex');
const lower = (s) => String(s).toLowerCase();
const catEnum = { 'Pain point': 'pain_point', Need: 'need', Expectation: 'expectation', Delight: 'delight' };

// Ids come from fixed names, so a reload replaces the same rows and links stay stable.
export function aid(key) {
  const h = createHash('sha1').update('signalflow-anchor-cx:' + key).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

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

// participants.csv: study,name,role,email,phone,session_date (a field with a comma is quoted).
function splitCsv(line) {
  const out = [];
  let cur = '', quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
function readParticipants() {
  return readFileSync(join(here, 'participants.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((line) => {
    const f = splitCsv(line);
    return { study: Number(f[0].match(/^\d+/)[0]), name: f[1], role: f[2], email: f[3], phone: f[4], date: f[5] };
  });
}

// Zoom and Teams both save .vtt; Teams marks the speaker with a voice tag. Meet saves plain text.
const platformOf = (file, text) => (extname(file) === '.txt' ? 'meet' : /<v /.test(text) ? 'teams' : 'zoom');

export const ANCHOR_PROJECT_IDS = D.PROJECTS.map((p) => aid('project:' + p.key));
const PLATFORM_IDS = Object.keys(D.THEMES).map((k) => aid('pt:' + k));
const REC_IDS = D.RECOMMENDATIONS.map((_, i) => aid('rec:' + i));

export async function loadAnchorCx(db, { workspaceId: WS, userId: USER }) {
  const q = (sql, params) => db.query(sql, params);

  // Remove an earlier load of this story (cascades to everything under it).
  await q('delete from core.projects where id = any($1::uuid[])', [ANCHOR_PROJECT_IDS]);
  await q('delete from insights.platform_themes where id = any($1::uuid[])', [PLATFORM_IDS]);
  await q('delete from insights.recommendations where id = any($1::uuid[])', [REC_IDS]);

  const allParticipants = readParticipants();
  const templateId = async (key) => (await q(`select id from core.templates where workspace_id = $1 and kind = 'study' and key = $2`, [WS, key])).rows[0]?.id ?? null;
  const built = {};

  for (const [pi, proj] of D.PROJECTS.entries()) {
    const P = aid('project:' + proj.key);
    const people = allParticipants.filter((p) => p.study === pi + 1);
    if (people.length !== 4) throw new Error(`${proj.name}: expected 4 participants, found ${people.length}`);

    await insert(db, 'core.projects', [{ id: P, workspace_id: WS, name: proj.name, color: proj.color, kind: 'research', template_id: await templateId(proj.tpl), owner_id: USER, created_by: USER }]);
    await insert(db, 'research.studies', [{ project_id: P, workspace_id: WS, what_testing: proj.what, outcomes: proj.outcomes, jtbd_when: proj.jtbd[0], jtbd_want: proj.jtbd[1], jtbd_so: proj.jtbd[2], methods: proj.methods }]);
    await insert(db, 'research.study_stages', D.STAGES.map((name, i) => ({ id: aid(`stage:${proj.key}:${i}`), workspace_id: WS, study_id: P, position: i, name })));
    await insert(db, 'research.participants', people.map((p, i) => ({
      id: aid(`part:${proj.key}:${i}`), workspace_id: WS, project_id: P, name: p.name, role: p.role, email: p.email.toLowerCase(), phone: p.phone,
      session_date: p.date, session_minutes: proj.minutes[i], position: i,
    })));
    const taskRows = [], followRows = [];
    proj.tasks.forEach((t, i) => {
      taskRows.push({ id: aid(`task:${proj.key}:${i}`), workspace_id: WS, project_id: P, position: i, prompt: t.q });
      t.fups.forEach((f, j) => followRows.push({ id: aid(`task:${proj.key}:${i}:${j}`), workspace_id: WS, project_id: P, parent_task_id: aid(`task:${proj.key}:${i}`), position: j, prompt: f }));
    });
    await insert(db, 'research.tasks', taskRows);
    await insert(db, 'research.tasks', followRows);

    // Transcripts -> speakers -> utterances
    const transcripts = proj.files.map((file, i) => {
      const text = readFileSync(join(here, 'transcripts', file), 'utf8');
      return { name: `Session ${i + 1} - ${people[i].name}${extname(file)}`, platform: platformOf(file, text), text };
    });
    const parsed = transcripts.map((t) => parseTranscript(t.text));
    const trRows = [], spkRows = [], uttRows = [];
    transcripts.forEach((t, ti) => {
      const TR = aid(`transcript:${proj.key}:${ti}`);
      trRows.push({ id: TR, workspace_id: WS, project_id: P, position: ti, name: t.name, platform: t.platform, raw_text: t.text, content_hash: sha(t.text) });
      const seen = new Set();
      parsed[ti].forEach((l, ui) => {
        const sk = lower(l.who);
        if (!seen.has(sk)) {
          seen.add(sk);
          const pIdx = l.mod ? -1 : people.findIndex((p) => lower(p.name) === sk);
          spkRows.push({ id: aid(`spk:${proj.key}:${ti}:${sk}`), workspace_id: WS, transcript_id: TR, name: l.who, role: l.mod ? 'moderator' : 'participant', participant_id: pIdx >= 0 ? aid(`part:${proj.key}:${pIdx}`) : null });
        }
        uttRows.push({ id: aid(`utt:${proj.key}:${ti}:${ui + 1}`), workspace_id: WS, transcript_id: TR, speaker_id: aid(`spk:${proj.key}:${ti}:${sk}`), position: ui + 1, timestamp_label: l.ts, text: l.text });
      });
    });
    await insert(db, 'research.transcripts', trRows);
    await insert(db, 'research.transcript_speakers', spkRows);
    await insert(db, 'research.utterances', uttRows);

    // The analysis run, and its themes with their quotes. Every quote is checked against the transcript it points to.
    const RUN = aid('run:analysis:' + proj.key);
    await insert(db, 'core.agent_runs', [{ id: RUN, workspace_id: WS, project_id: P, kind: 'analysis', status: 'complete', input_hash: sha(transcripts.map((t) => `${t.name}:${sha(t.text)}`).join('|')), provider: 'stub', prompt_version: 'anchor-cx-v1', finished_at: new Date() }]);
    const BUSY = ['Parsing transcripts', 'Identifying speakers', 'Clustering statements', 'Scoring and prioritizing', 'Porting themes to journey map'];
    await insert(db, 'core.agent_steps', BUSY.map((title, i) => ({ id: aid(`step:analysis:${proj.key}:${i}`), workspace_id: WS, run_id: RUN, position: i + 1, key: lower(title).replace(/[^a-z]+/g, '_'), title, status: 'approved' })));

    const themes = Object.entries(proj.themes).map(([tk, t]) => {
      const def = D.THEMES[tk];
      const quotes = t.quotes.map(([person, pos]) => {
        const line = parsed[person]?.[pos - 1];
        if (!line || line.mod || lower(line.who) !== lower(people[person].name)) throw new Error(`${proj.name} ${tk}: line ${pos} of transcript ${person} is not said by ${people[person].name}`);
        return { t: person, u: pos, who: line.who, text: line.text };
      });
      const ppl = new Set(quotes.map((x) => x.who)).size;
      const { score, prio } = scoreTheme({ ppl, total: people.length, mentions: quotes.length, sev: def.sev });
      return { tk, id: aid(`theme:${proj.key}:${tk}`), def, desc: t.desc, quotes, ppl, score, prio };
    }).sort((a, b) => b.score - a.score);

    await insert(db, 'research.themes', themes.map((th) => ({
      id: th.id, workspace_id: WS, project_id: P, run_id: RUN, title: th.def.title, category: catEnum[th.def.cat], stage_position: th.def.stage, severity: th.def.sev,
      description: th.desc, opportunity: th.def.opp, suggested_priority: lower(th.prio), suggested_effort: th.def.eff, effort_note: th.def.effNote, score: Number(th.score.toFixed(4)),
    })));
    await insert(db, 'research.theme_quotes', themes.flatMap((th) => th.quotes.map((qt) => ({ theme_id: th.id, utterance_id: aid(`utt:${proj.key}:${qt.t}:${qt.u}`), workspace_id: WS }))));
    built[proj.key] = { P, themes, people };
  }

  // Study 1's requirements document, published, with its board and designs -------
  {
    const proj = D.PROJECTS[0], { P, themes, people } = built.a1;
    const byKey = Object.fromEntries(themes.map((t) => [t.tk, t]));
    const RUN = aid('run:spec:a1'), SPEC = aid('spec:a1');
    await insert(db, 'core.agent_runs', [{ id: RUN, workspace_id: WS, project_id: P, kind: 'spec', status: 'complete', provider: 'stub', prompt_version: 'spec-steps-v1', finished_at: new Date() }]);
    await insert(db, 'delivery.specs', [{ id: SPEC, workspace_id: WS, project_id: P, name: proj.name, agent_run_id: RUN, status: 'draft', created_by: USER }]);
    await insert(db, 'delivery.spec_themes', themes.map((t) => ({ spec_id: SPEC, theme_id: t.id, workspace_id: WS, included: true })));

    const reqStories = D.STORIES.filter((s) => !s.open);
    const stepRows = [], altRows = [], evRows = [];
    D.STEPS.forEach((s, i) => {
      const STEP = aid(`step:spec:a1:${i}`);
      const out = s.out ?? ['Requirements', reqStories.map((st) => `${st.key}: ${D.THEMES[st.theme].opp} (${byKey[st.theme].ppl} of ${people.length} participants)`)];
      const [heading, second, third] = out;
      stepRows.push({
        id: STEP, workspace_id: WS, run_id: RUN, position: i + 1, key: s.key, title: s.title, reasoning: s.reasoning, status: 'approved', revision: 0,
        output: { heading, text: Array.isArray(second) ? null : second || null, items: Array.isArray(second) ? second : third || null },
        approved_by: USER, approved_at: new Date(),
      });
      s.alts.forEach((a, j) => altRows.push({ id: aid(`alt:spec:a1:${i}:${j}`), workspace_id: WS, step_id: STEP, position: j, title: a.title, reason: a.reason }));
      s.themes.forEach((tk) => evRows.push({ step_id: STEP, theme_id: byKey[tk].id, workspace_id: WS }));
    });
    await insert(db, 'core.agent_steps', stepRows);
    await insert(db, 'core.agent_step_alternatives', altRows);
    await insert(db, 'delivery.spec_step_evidence', evRows);

    const reqRows = [], storyRows = [], checkRows = [], designRows = [];
    const perStatus = {};
    for (const s of D.STORIES) {
      const th = byKey[s.theme];
      const REQ = s.open ? null : aid('req:' + s.key);
      const STORY = aid('story:' + s.key);
      if (!s.open) reqRows.push({ id: REQ, workspace_id: WS, spec_id: SPEC, theme_id: th.id, title: s.title, category: catEnum[th.def.cat], priority: s.priority, effort: th.def.eff, opportunity: th.def.opp, supporting_quote: th.quotes[0].text });
      perStatus[s.status] = (perStatus[s.status] || 0) + 1;
      storyRows.push({
        id: STORY, workspace_id: WS, spec_id: SPEC, requirement_id: REQ, theme_id: th.id, kind: s.open ? 'open_question' : 'requirement', key: s.key, title: s.title, status: s.status,
        position: perStatus[s.status] * 1000, priority: s.priority, owner_team: s.owner, summary: s.short, why_it_matters: s.why, next_step: s.next,
      });
      s.criteria.forEach(([kind, text, met], i) => checkRows.push({ id: aid(`check:${s.key}:${i}`), workspace_id: WS, story_id: STORY, kind, text, met, position: i }));
      if (s.design) designRows.push({ id: aid('design:' + s.key), workspace_id: WS, story_id: STORY, notes: s.design, created_by: USER, updated_by: USER });
    }
    await insert(db, 'delivery.requirements', reqRows);
    await insert(db, 'delivery.stories', storyRows);
    await insert(db, 'delivery.story_checklist', checkRows);
    await q(`update delivery.specs set status = 'published' where id = $1`, [SPEC]);
    await insert(db, 'delivery.design_items', designRows);
  }

  // Study 1's launch: answered by the reviewers the workspace already has (their own setup is never touched); a workspace with none gets a few, so the demo reads ---
  {
    const { P } = built.a1;
    const SPEC = aid('spec:a1');
    const LAUNCH = aid('launch:a1');
    const L = D.LAUNCH;
    await insert(db, 'delivery.launches', [{ id: LAUNCH, workspace_id: WS, project_id: P, name: L.name, target_date: L.targetDate, brief_notes: L.notes, created_by: USER, updated_by: USER }]);
    const team = (await q('select team_id from core.projects where id = $1', [P])).rows[0].team_id;
    let assigns = (await q('select user_id, step, team_id, role from core.reviewer_assignments where workspace_id = $1', [WS])).rows;
    if (assigns.length === 0) {
      const people = (await q(`select m.user_id, m.role from core.memberships m where m.workspace_id = $1 order by m.created_at`, [WS])).rows;
      const owner = people.find((p) => p.role === 'owner')?.user_id ?? USER;
      const editor = people.find((p) => p.role === 'editor')?.user_id ?? owner;
      const other = people.find((p) => p.role !== 'owner' && p.user_id !== editor)?.user_id ?? editor;
      const demo = [[owner, 'product_leadership'], [owner, 'final_decision'], [editor, 'legal'], [editor, 'sales'], [editor, 'marketing'], [other, 'documentation']];
      await insert(db, 'core.reviewer_assignments', demo.map(([user_id, step]) => ({ workspace_id: WS, user_id, step, team_id: null, role: 'primary', created_by: USER })));
      assigns = (await q('select user_id, step, team_id, role from core.reviewer_assignments where workspace_id = $1', [WS])).rows;
    }
    const cover = assigns.map((r) => ({ userId: r.user_id, step: r.step, teamId: r.team_id, role: r.role }));
    // The brief the answers are given on: the published document and the launch's notes, as the server reads them.
    const spec = (await q('select id, published_at from delivery.specs where id = $1', [SPEC])).rows[0];
    const notes = (await q('select notes_updated_at from delivery.launches where id = $1', [LAUNCH])).rows[0];
    const briefKey = `${spec.id}|${spec.published_at ? new Date(spec.published_at).toISOString() : ''}|${new Date(notes.notes_updated_at).toISOString()}`;
    const answerRows = [], linkRows = [];
    for (const a of L.answers) {
      const who = reviewersFor(cover, team, a.step).primary[0];
      if (!who) continue; // nobody is set up for this step: it shows as "Approver missing"
      answerRows.push({ id: aid('launch-answer:' + a.step), launch_id: LAUNCH, step: a.step, answer: a.answer, rationale: a.rationale, brief_key: briefKey, answered_by: who, answered_at: new Date(Date.now() - a.daysAgo * 86400000) });
      for (const [i, l] of a.links.entries()) linkRows.push({ id: aid(`launch-link:${a.step}:${i}`), launch_id: LAUNCH, step: a.step, title: l.title, url: l.url, added_by: who });
    }
    // The final decision, by the final approver, with the steps it went past.
    const final = L.final;
    const finalBy = reviewersFor(cover, team, final.step).primary[0];
    if (finalBy) answerRows.push({ id: aid('launch-answer:' + final.step), launch_id: LAUNCH, step: final.step, answer: final.answer, rationale: final.rationale, brief_key: briefKey, open_items: JSON.stringify(final.open.map((o) => ({ ...o, label: stepLabel(o.step) }))), answered_by: finalBy, answered_at: new Date(Date.now() - final.daysAgo * 86400000) });
    await insert(db, 'delivery.launch_answers', answerRows);
    await insert(db, 'delivery.launch_links', linkRows);
    // The launch's measures, with the readings the review points have produced so far (simulated).
    const day = (daysAgo) => new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10);
    await insert(db, 'delivery.launch_measures', L.measures.map((m, i) => ({
      id: aid('launch-measure:' + i), workspace_id: WS, launch_id: LAUNCH, position: i, metric_kind: m.metricKind, detail: m.detail, comparison: m.comparison, value_a: m.valueA, value_b: m.valueB, unit: m.unit || null,
      requirement_keys: m.covers, checkins: JSON.stringify(m.readings.map((r) => ({ on: day(r.daysAgo), value: r.value, verdict: r.verdict, note: r.note }))), created_by: USER, updated_by: USER,
    })));
    await q('update delivery.launches set measures_version = 1 where id = $1', [LAUNCH]);
  }

  // Platform Insights: the same seven problems, rolled up across the three studies --------------
  {
    const offset = Number((await q('select coalesce(max(position) + 1, 0)::int n from insights.platform_themes where workspace_id = $1', [WS])).rows[0].n);
    const keys = Object.keys(D.THEMES);
    await insert(db, 'insights.platform_themes', keys.map((tk, i) => ({ id: aid('pt:' + tk), workspace_id: WS, title: D.THEMES[tk].title, category: catEnum[D.THEMES[tk].cat], position: offset + i })));
    await insert(db, 'insights.platform_theme_sources', Object.entries(built).flatMap(([key, b]) => b.themes.map((t) => {
      const manual = key === 'a3' && t.tk === 'T6'; // one tagged by hand, as the original demo shows
      return { platform_theme_id: aid('pt:' + t.tk), theme_id: t.id, workspace_id: WS, match_method: manual ? 'manual' : 'auto', confidence: manual ? null : 0.9 };
    })));
    const recOffset = Number((await q('select coalesce(max(position) + 1, 0)::int n from insights.recommendations where workspace_id = $1', [WS])).rows[0].n);
    await insert(db, 'insights.recommendations', D.RECOMMENDATIONS.map((r, i) => ({ id: aid('rec:' + i), workspace_id: WS, title: r.title, why: r.why, priority: r.priority, position: recOffset + i })));
    await insert(db, 'insights.recommendation_themes', D.RECOMMENDATIONS.flatMap((r, i) => r.themes.map((tk) => ({ recommendation_id: aid('rec:' + i), platform_theme_id: aid('pt:' + tk), workspace_id: WS }))));
  }

  return summarize(db);
}

// The two later themes (T8 and T9, raised in studies 2 and 3) added to a workspace that already has the story, WITHOUT reloading it: a reload deletes and recreates the three
// studies, and with them anything built on them by hand (a requirements document, a launch). Everything here is an insert or an update of a row this story owns, and each part is
// skipped when it is already there, so it is safe to run again. The result is what a fresh load of the current story would have: the new lines at the end of eight transcripts (and
// their utterances), the two themes with their quotes in studies 2 and 3, the two platform themes and what they roll up, and the sixth recommendation.
export const LATER_THEMES = ['T8', 'T9'];
export async function addLaterThemes(db, { workspaceId: WS, userId: USER }) {
  const q = (sql, params) => db.query(sql, params);
  const allParticipants = readParticipants();
  const did = { utterances: 0, themes: 0, quotes: 0, platformThemes: 0, matches: 0, recommendations: 0 };

  for (const [pi, proj] of D.PROJECTS.entries()) {
    const wanted = LATER_THEMES.filter((tk) => proj.themes[tk]);
    if (!wanted.length) continue;
    const P = aid('project:' + proj.key);
    if (!(await q('select 1 from core.projects where id = $1 and workspace_id = $2', [P, WS])).rows[0]) continue; // the story is not loaded here
    const people = allParticipants.filter((p) => p.study === pi + 1);
    const transcripts = proj.files.map((file, i) => {
      const text = readFileSync(join(here, 'transcripts', file), 'utf8');
      return { name: `Session ${i + 1} - ${people[i].name}${extname(file)}`, text };
    });
    const parsed = transcripts.map((t) => parseTranscript(t.text));

    // 1. The new lines at the end of each transcript.
    for (const [ti, t] of transcripts.entries()) {
      const TR = aid(`transcript:${proj.key}:${ti}`);
      const row = (await q('select raw_text, (select count(*)::int from research.utterances u where u.transcript_id = research.transcripts.id) as n from research.transcripts where id = $1', [TR])).rows[0];
      if (!row) throw new Error(`${proj.name}: transcript ${ti + 1} is missing`);
      if (row.raw_text === t.text) continue;
      if (!t.text.startsWith(row.raw_text.trimEnd())) throw new Error(`${proj.name}: transcript ${ti + 1} was changed, not only added to: not touching it`);
      const fresh = parsed[ti].slice(row.n);
      const uttRows = [];
      for (const [k, l] of fresh.entries()) {
        const sk = lower(l.who);
        if (!(await q('select 1 from research.transcript_speakers where id = $1', [aid(`spk:${proj.key}:${ti}:${sk}`)])).rows[0]) throw new Error(`${proj.name}: speaker ${l.who} is missing from transcript ${ti + 1}`);
        uttRows.push({ id: aid(`utt:${proj.key}:${ti}:${row.n + k + 1}`), workspace_id: WS, transcript_id: TR, speaker_id: aid(`spk:${proj.key}:${ti}:${sk}`), position: row.n + k + 1, timestamp_label: l.ts, text: l.text });
      }
      await insert(db, 'research.utterances', uttRows);
      await q('update research.transcripts set raw_text = $2, content_hash = $3 where id = $1', [TR, t.text, sha(t.text)]);
      did.utterances += uttRows.length;
    }
    // The analysis run records what it was run on, so the study is not "out of date" because of lines that were added to match it.
    await q('update core.agent_runs set input_hash = $2 where id = $1', [aid('run:analysis:' + proj.key), sha(transcripts.map((t) => `${t.name}:${sha(t.text)}`).join('|'))]);

    // 2. The themes, with their quotes (each checked against the line it points to).
    for (const tk of wanted) {
      const id = aid(`theme:${proj.key}:${tk}`);
      if ((await q('select 1 from research.themes where id = $1', [id])).rows[0]) continue;
      const def = D.THEMES[tk];
      const quotes = proj.themes[tk].quotes.map(([person, pos]) => {
        const line = parsed[person]?.[pos - 1];
        if (!line || line.mod || lower(line.who) !== lower(people[person].name)) throw new Error(`${proj.name} ${tk}: line ${pos} of transcript ${person} is not said by ${people[person].name}`);
        return { t: person, u: pos, who: line.who };
      });
      const ppl = new Set(quotes.map((x) => x.who)).size;
      const { score, prio } = scoreTheme({ ppl, total: people.length, mentions: quotes.length, sev: def.sev });
      await insert(db, 'research.themes', [{
        id, workspace_id: WS, project_id: P, run_id: aid('run:analysis:' + proj.key), title: def.title, category: catEnum[def.cat], stage_position: def.stage, severity: def.sev,
        description: proj.themes[tk].desc, opportunity: def.opp, suggested_priority: lower(prio), suggested_effort: def.eff, effort_note: def.effNote, score: Number(score.toFixed(4)),
      }]);
      await insert(db, 'research.theme_quotes', quotes.map((qt) => ({ theme_id: id, utterance_id: aid(`utt:${proj.key}:${qt.t}:${qt.u}`), workspace_id: WS })));
      did.themes++;
      did.quotes += quotes.length;
      // 3. What the theme rolls up into on Platform Insights.
      if (!(await q('select 1 from insights.platform_themes where id = $1', [aid('pt:' + tk)])).rows[0]) {
        const pos = Number((await q('select coalesce(max(position) + 1, 0)::int n from insights.platform_themes where workspace_id = $1', [WS])).rows[0].n);
        await insert(db, 'insights.platform_themes', [{ id: aid('pt:' + tk), workspace_id: WS, title: def.title, category: catEnum[def.cat], position: pos }]);
        did.platformThemes++;
      }
      await insert(db, 'insights.platform_theme_sources', [{ platform_theme_id: aid('pt:' + tk), theme_id: id, workspace_id: WS, match_method: 'auto', confidence: 0.9 }]);
      did.matches++;
    }
  }

  // 4. The recommendations that cover the later themes.
  for (const [i, r] of D.RECOMMENDATIONS.entries()) {
    if (!r.themes.some((tk) => LATER_THEMES.includes(tk))) continue;
    if ((await q('select 1 from insights.recommendations where id = $1', [aid('rec:' + i)])).rows[0]) continue;
    const pos = Number((await q('select coalesce(max(position) + 1, 0)::int n from insights.recommendations where workspace_id = $1', [WS])).rows[0].n);
    await insert(db, 'insights.recommendations', [{ id: aid('rec:' + i), workspace_id: WS, title: r.title, why: r.why, priority: r.priority, position: pos }]);
    await insert(db, 'insights.recommendation_themes', r.themes.map((tk) => ({ recommendation_id: aid('rec:' + i), platform_theme_id: aid('pt:' + tk), workspace_id: WS })));
    did.recommendations++;
  }
  return did;
}

export async function summarize(db) {
  const count = async (sql, p) => Number((await db.query(sql, p)).rows[0].n);
  const ids = ANCHOR_PROJECT_IDS;
  return {
    projects: await count('select count(*)::int n from core.projects where id = any($1::uuid[])', [ids]),
    participants: await count('select count(*)::int n from research.participants where project_id = any($1::uuid[])', [ids]),
    transcripts: await count('select count(*)::int n from research.transcripts where project_id = any($1::uuid[])', [ids]),
    themes: await count('select count(*)::int n from research.themes where project_id = any($1::uuid[])', [ids]),
    stories: await count('select count(*)::int n from delivery.stories st join delivery.specs sp on sp.id = st.spec_id where sp.project_id = any($1::uuid[])', [ids]),
    launches: await count('select count(*)::int n from delivery.launches where project_id = any($1::uuid[])', [ids]),
    measures: await count('select count(*)::int n from delivery.launch_measures m join delivery.launches l on l.id = m.launch_id where l.project_id = any($1::uuid[])', [ids]),
    platformThemes: await count('select count(*)::int n from insights.platform_themes where id = any($1::uuid[])', [PLATFORM_IDS]),
    recommendations: await count('select count(*)::int n from insights.recommendations where id = any($1::uuid[])', [REC_IDS]),
  };
}
