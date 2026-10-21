// Phase 1 stand-ins for the three AI interfaces, ported from the prototype so the database
// reproduces what the prototype shows. Each takes plain data and returns plain data, so a real
// model can replace any of them later without touching the schema, API or screens.
//
//   analyze()        AnalysisProvider  transcripts -> themes with quotes
//   buildSteps()     SpecDrafter       project context -> the 8 reviewed spec steps
//   matchThemes()    ThemeMatcher      project themes -> platform themes

// Transcript parsing ------------------------------------------------------------------------

export function parseTranscript(text) {
  const out = [];
  let last = '';
  String(text).split(/\r?\n/).forEach((raw) => {
    let l = raw.trim();
    if (!l || /^WEBVTT|^NOTE|^\d+$/.test(l)) return;
    if (l.includes('-->')) { last = l.slice(0, 8); return; }
    let ts = last, who, t;
    let m = l.match(/^<v ([^>]+)>(.*?)(<\/v>)?$/);
    if (m) { who = m[1]; t = m[2]; }
    else {
      const tm = l.match(/^\[?(\d{1,2}:\d{2}(?::\d{2})?)/);
      if (tm) ts = tm[1];
      l = l.replace(/^\[?\d{1,2}:\d{2}(:\d{2})?(\.\d+)?\]?\s*/, '');
      m = l.match(/^([^:]{2,40}):\s+(.+)$/);
      if (!m) return;
      who = m[1]; t = m[2];
    }
    out.push({ who: who.trim(), text: t.trim(), ts: ts || '', mod: /moderator|interviewer|researcher|facilitator/i.test(who) });
  });
  return out;
}

// Scoring, shared by the analysis stub and the seed for hand-built themes --------------------

export function scoreTheme({ ppl, total, mentions, sev }) {
  const score = 0.5 * (ppl / total) + 0.3 * Math.min(mentions / 6, 1) + 0.2 * Math.abs(sev);
  const prio = score >= 0.6 ? 'High' : score >= 0.4 ? 'Medium' : 'Low';
  return { score, prio };
}

// AnalysisProvider (stub) --------------------------------------------------------------------
// transcripts: [{ name, text }]; participants: [{ name }]; defs: research.json TH; eff: research.json EFF.
// Each quote records where it came from: { t: transcript index, u: index into parseTranscript(text) }.

export function analyze(transcripts, participants, defs, eff) {
  const pp = participants || [];
  const key = (w) => {
    const i = pp.findIndex((p) => p.name && p.name.toLowerCase() === String(w).toLowerCase());
    return i >= 0 ? 'pt' + i : 'sp:' + String(w).toLowerCase();
  };
  const parts = {};
  const themes = defs.map((d) => ({ ...d, quotes: [] }));
  transcripts.forEach((tr, t) => parseTranscript(tr.text).forEach((l, u) => {
    if (l.mod) return;
    parts[key(l.who)] = 1;
    const low = l.text.toLowerCase();
    themes.forEach((th) => {
      if (th.kw.some((k) => low.includes(k))) th.quotes.push({ t, u, who: l.who, pid: key(l.who), text: l.text, ts: l.ts });
    });
  }));
  const total = Math.max(1, Object.keys(parts).length);
  return themes
    .filter((th) => th.quotes.length)
    .map((th) => {
      const ppl = new Set(th.quotes.map((q) => q.pid)).size;
      const mentions = th.quotes.length;
      const { score, prio } = scoreTheme({ ppl, total, mentions, sev: th.sev });
      const ef = eff[th.id] || [2, 'Effort not yet estimated.'];
      return { ...th, ppl, total, mentions, score, prio, eff: ef[0], effNote: ef[1] };
    })
    .sort((a, b) => b.score - a.score);
}

// SpecDrafter (stub) -------------------------------------------------------------------------
// ctx: { what, jtbd: [when, want, so] | null, outcomes, people: [role], sessions, themes: [{ id, title,
//        cat, prio, ppl, total, eff, opp, quote }] }; inc: { [themeId]: boolean }.
// Returns 8 steps: { t, r, ev: ['title · ppl/total'], alts: [{ title, reason }], out }.

export function buildSteps(ctx, inc) {
  const th = ctx.themes.filter((t) => inc[t.id]);
  const has = th.some((t) => t.cat === 'Pain point');
  const n = ctx.sessions || 0;
  const rk = (t) => (t.prio === 'High' ? 3 : t.prio === 'Medium' ? 2 : 1) * 10 + t.ppl;
  const pains = th.filter((t) => t.cat === 'Pain point').sort((a, b) => rk(b) - rk(a));
  const inS = th.filter((t) => t.eff <= 2).sort((a, b) => rk(b) - rk(a));
  const outS = th.filter((t) => t.eff === 3);
  const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  const j = (a) => (a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]);
  const ev = (a) => a.slice(0, 4).map((t) => t.title + ' · ' + t.ppl + '/' + t.total);
  const top = pains.slice(0, 3);
  const what = ctx.what || 'the described change';
  const jt = ctx.jtbd && ctx.jtbd[0] ? `When ${ctx.jtbd[0]}, I want to ${ctx.jtbd[1]}, so I can ${ctx.jtbd[2]}.` : '';
  const S = [];

  S.push(has
    ? { t: 'Frame the problem', r: `Across ${n} sessions, participants raised ${pains.length} pain points. The most widespread are ${j(top.map((t) => lc(t.title)))}. "${top[0].title}" came up with ${top[0].ppl} of ${top[0].total} participants; one said, "${top[0].quote}" The problem statement centers on these barriers to ${lc(what)}.`,
        ev: ev(top),
        alts: [{ title: 'Frame around the lowest-effort fix', reason: 'It would hide the barriers participants rated most severe.' }, { title: 'Frame as a visual design problem', reason: 'Quotes describe missing information and steps, not appearance.' }],
        out: ['Problem', `Participants struggle with ${j(top.map((t) => lc(t.title)))}, which keeps them from ${lc(what)}.`] }
    : { t: 'Frame the problem', r: `No research is attached, so the problem statement rests on your description: "${what}". Assumptions about severity and frequency are flagged for validation.`, ev: [], alts: [], out: ['Problem', `${what}. Severity and frequency have not been validated with research.`] });

  S.push(has
    ? { t: 'Identify users and jobs', r: `${ctx.people.length ? 'Participants were ' + j(ctx.people.map(lc)) + '. ' : ''}${jt ? 'The job to be done carries over from the project plan: ' + lc(jt) + ' ' : ''}The primary user is anyone booking for themselves or a family member.`,
        ev: [], alts: [{ title: 'Split into separate new and returning patient personas', reason: `With ${n} sessions the differences are not strong enough to justify two.` }],
        out: ['Users', (ctx.people.length ? j(ctx.people.map(lc)) : 'Patients') + '. ' + jt] }
    : { t: 'Identify users and jobs', r: 'No participants or job to be done are attached. The primary user is assumed from the description and needs confirming before approval.', ev: [], alts: [], out: ['Users', 'Primary user to be confirmed. Assumed from the description: ' + what + '.'] });

  const gb = [...(ctx.outcomes || []), ...top.slice(0, 2).map((t) => `Reduce "${lc(t.title)}" reports from ${t.ppl} of ${t.total} participants to none in the next round.`)];
  S.push({ t: 'Define goals and success metrics',
    r: has ? 'Goals come from the expected outcomes in the project plan, plus a measurable target for each of the top two pain points so the next research round can confirm the fix.' : 'Goals are drafted from your description. Add measurable targets once research is available.',
    ev: ev(top.slice(0, 2)), alts: has ? [{ title: 'Track daily active use', reason: 'Usage does not show whether the barriers are fixed.' }] : [],
    out: ['Goals', '', has ? gb : ['The change in "' + what + '" ships and is usable without assistance.', 'Success metrics to be defined.']] });

  S.push({ t: 'Set scope',
    r: has ? `In scope are ${inS.length} themes with low or medium estimated effort. ${outS.length ? j(outS.map((t) => lc(t.title))) + ' ' + (outS.length > 1 ? 'need' : 'needs') + ' larger integrations, so ' + (outS.length > 1 ? 'they are' : 'it is') + ' held out of this release.' : ''}` : 'Scope is limited to what the description names. Anything else is out of scope until requested.',
    ev: ev(inS), alts: outS.length ? [{ title: 'Include ' + lc(outS[0].title) + ' now', reason: 'The estimated effort would take over the release.' }] : [],
    out: ['Scope', has ? `In scope: ${j(inS.map((t) => lc(t.title)))}.${outS.length ? ' Out of scope for now: ' + j(outS.map((t) => lc(t.title))) + '.' : ''}` : 'In scope: ' + what + '. Out of scope: everything not named.'] });

  S.push({ t: 'Draft requirements',
    r: has ? 'Each in-scope theme becomes a testable requirement written from the opportunity noted in Signal Flow, ordered by priority and number of participants affected.' : 'Requirements are drafted as testable statements from the description and should be reviewed with the team.',
    ev: ev(inS), alts: has ? [{ title: 'One requirement per quote', reason: 'Quotes overlap and would produce duplicates.' }] : [],
    out: ['Requirements', has ? inS.map((t, i) => `R${i + 1}: ${t.opp} (${t.ppl} of ${t.total} participants)`) : ['R1: ' + what + '.', 'R2: The change can be verified by a test with real users.']] });

  S.push({ t: 'Assess risks and dependencies',
    r: has ? `Held-out themes point to the main dependencies. ${outS.length ? j(outS.map((t) => t.title)) + ' would need work outside this team.' : ''} Self-serve changes and prefilled data also affect scheduling and account systems.` : 'Risks are generic until the technical context is known: unclear ownership, unvalidated assumptions and missing dependencies.',
    ev: ev(outS), alts: [],
    out: ['Risks and dependencies', has ? `Dependencies: scheduling rules for self-serve changes, account data for prefilled forms${outS.length ? ', and larger integrations for ' + j(outS.map((t) => lc(t.title))) : ''}.` : 'Dependencies to be identified with engineering.'] });

  S.push({ t: 'Plan the rollout',
    r: `Release behind a flag to a small group, then verify the changes with a second research round using the same tasks as ${has ? 'the first round' : 'a baseline test'}. Advance when the targets in step 3 are met.`,
    ev: [], alts: [{ title: 'Launch to everyone at once', reason: 'There is no safe way to compare against the baseline.' }],
    out: ['Rollout', 'Stage 1: internal group behind a flag. Stage 2: follow-up research round with the same tasks. Stage 3: general availability when goals are met.'] });

  S.push({ t: 'List open questions',
    r: has ? `${outS.length ? 'Held-out themes with high priority need an owner decision. ' : ''}The team also needs to confirm how fees are shown and what self-serve changes are allowed.` : 'Open questions cover users, success measures and scope, since none are backed by research.',
    ev: ev(outS), alts: [],
    out: ['Open questions', has ? outS.map((t) => `Should "${lc(t.title)}" move into scope? It was raised by ${t.ppl} of ${t.total} participants.`).concat(['Which fees and change windows are allowed for self-serve changes?']) : ['Who is the primary user?', 'Which metrics define success?']] });

  return S;
}

// ThemeMatcher (stub) ------------------------------------------------------------------------
// Groups project themes under platform themes by keyword families. A hit in the title counts 2,
// a hit in the description or opportunity counts 1, and a theme needs at least MIN_HITS to match,
// so one passing mention (a review theme that says "availability") stays unmatched. Keywords are
// regular-expression fragments matched on word boundaries ("fees?" matches "fee", not "feel").
// platformThemes: [{ id, keywords: [string] }]; themes: [{ id, title, description, opportunity }].
// Returns [{ themeId, platformThemeId, confidence }].

export const MIN_HITS = 2;

export function matchThemes(themes, platformThemes) {
  const test = (k, text) => new RegExp('\\b(?:' + k + ')\\b').test(text);
  const out = [];
  for (const th of themes) {
    const title = (th.title || '').toLowerCase();
    const rest = ((th.description || '') + ' ' + (th.opportunity || '')).toLowerCase();
    let best = null;
    for (const pt of platformThemes) {
      let hits = 0;
      for (const k of pt.keywords) {
        if (test(k, title)) hits += 2;
        else if (test(k, rest)) hits += 1;
      }
      if (hits >= MIN_HITS && (!best || hits > best.hits)) best = { pt, hits };
    }
    if (best) out.push({ themeId: th.id, platformThemeId: best.pt.id, confidence: Math.min(0.95, 0.5 + 0.1 * best.hits) });
  }
  return out;
}
