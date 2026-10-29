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
    await insert(db, 'research.studies', [{ project_id: P, workspace_id: WS, jtbd_when: proj.jtbd[0], jtbd_want: proj.jtbd[1], jtbd_so: proj.jtbd[2], methods: proj.methods }]);
    await insert(db, 'research.test_items', [{ id: aid(`item:${proj.key}`), workspace_id: WS, project_id: P, position: 0, description: proj.what, outcomes: proj.outcomes }]);
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

  // Study 1's requirements document, published, with its board, designs and measured results -------
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

    const reqRows = [], storyRows = [], checkRows = [], designRows = [], measureRows = [];
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
      if (s.measure) measureRows.push({ id: aid('measure:' + s.key), workspace_id: WS, story_id: STORY, metric: s.measure.metric, source: s.measure.source, baseline: s.measure.baseline, target: s.measure.target, checkins: JSON.stringify(s.measure.checkins), created_by: USER, updated_by: USER });
    }
    await insert(db, 'delivery.requirements', reqRows);
    await insert(db, 'delivery.stories', storyRows);
    await insert(db, 'delivery.story_checklist', checkRows);
    await q(`update delivery.specs set status = 'published' where id = $1`, [SPEC]);
    await insert(db, 'delivery.design_items', designRows);
    await insert(db, 'delivery.success_measures', measureRows);
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

export async function summarize(db) {
  const count = async (sql, p) => Number((await db.query(sql, p)).rows[0].n);
  const ids = ANCHOR_PROJECT_IDS;
  return {
    projects: await count('select count(*)::int n from core.projects where id = any($1::uuid[])', [ids]),
    participants: await count('select count(*)::int n from research.participants where project_id = any($1::uuid[])', [ids]),
    transcripts: await count('select count(*)::int n from research.transcripts where project_id = any($1::uuid[])', [ids]),
    themes: await count('select count(*)::int n from research.themes where project_id = any($1::uuid[])', [ids]),
    stories: await count('select count(*)::int n from delivery.stories st join delivery.specs sp on sp.id = st.spec_id where sp.project_id = any($1::uuid[])', [ids]),
    measures: await count('select count(*)::int n from delivery.success_measures m join delivery.stories st on st.id = m.story_id join delivery.specs sp on sp.id = st.spec_id where sp.project_id = any($1::uuid[])', [ids]),
    platformThemes: await count('select count(*)::int n from insights.platform_themes where id = any($1::uuid[])', [PLATFORM_IDS]),
    recommendations: await count('select count(*)::int n from insights.recommendations where id = any($1::uuid[])', [REC_IDS]),
  };
}
