// The two documents a reviewer reads before they are asked to approve, as pages that print: the storyboard (the research as a short deck: the problem, what people
// said, the recommended directions and their trade-offs) and the published requirements (the brief and the document's sections). Like the launch record
// (launch-export.ts) each is complete in itself, with every piece of user text escaped, and says when it was made. Pure: no I/O.
import { day, esc, moment, STYLE } from './launch-export.js'
import type { SpecDetail } from './specs.js'
import type { Storyboard } from './storyboard.js'

const CATEGORY: Record<string, string> = { pain_point: 'Where people struggled', need: 'What people need', expectation: 'What people expect', delight: 'What people liked' }
const EXTRA = `
  .solution { border: 1px solid #d6dbe0; border-radius: 8pt; padding: 10pt 12pt; margin: 0 0 8pt; break-inside: avoid; }
  .solution dl { margin: 6pt 0 0; display: grid; grid-template-columns: 7.5em 1fr; gap: 2pt 8pt; font-size: 9.5pt; }
  .solution dt { color: #5c6773; } .solution dd { margin: 0; }
  blockquote { margin: 4pt 0 0; padding-left: 8pt; border-left: 3px solid #d6dbe0; color: #333840; }
  .who { font-size: 9pt; color: #5c6773; }
  .theme { margin: 0 0 9pt; break-inside: avoid; }
`
const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${STYLE}${EXTRA}</style></head><body>${body}</body></html>`

/** The storyboard of a launch's project, or a page saying it has not been written. `at` is when the snapshot is made. */
export function storyboardHtml(board: Storyboard, launchName: string, at: Date = new Date()): string {
  const f = board.facts
  const d = board.draft
  const meta = [`${f.participants} ${f.participants === 1 ? 'participant' : 'participants'}`, `${f.sessions} ${f.sessions === 1 ? 'session' : 'sessions'}`, f.when ? `${day(f.when.from)} to ${day(f.when.to)}` : null].filter(Boolean).join(' · ')
  if (!d) {
    return page(`${launchName}: storyboard`, `<p class="eyebrow">Storyboard</p><h1>${esc(launchName)}</h1><p class="meta">${esc(meta)}</p><p class="muted">The storyboard has not been written yet.</p>`)
  }
  const themes = f.themes
    .map(
      (t) =>
        `<div class="theme"><h3>${esc(t.title)}</h3><p class="by">${esc(CATEGORY[t.category] ?? t.category)} · ${t.participants} of ${t.totalParticipants} participants</p>` +
        (t.quote ? `<blockquote>“${esc(t.quote.text)}”<div class="who">${esc(t.quote.who)}</div></blockquote>` : '') +
        '</div>',
    )
    .join('')
  const solutions = d.solutions
    .map(
      (s, i) =>
        `<section class="solution"><h3>${i + 1}. ${esc(s.name)}</h3><p>${esc(s.description)}</p>` +
        (s.themes.length ? `<p class="by">Answers: ${s.themes.map((t) => esc(t.title)).join('; ')}</p>` : '') +
        `<dl><dt>Benefit</dt><dd>${esc(s.benefit)}</dd><dt>Cost</dt><dd>${esc(s.cost)}</dd><dt>Risk</dt><dd>${esc(s.risk)}</dd><dt>Gives up</dt><dd>${esc(s.giveUp)}</dd><dt>Alternatives</dt><dd>${esc(s.alternatives)}</dd></dl></section>`,
    )
    .join('')
  return page(
    `${launchName}: storyboard`,
    [
      `<p class="eyebrow">Storyboard</p><h1>${esc(d.headline)}</h1><p class="meta">${esc(launchName)} · ${esc(meta)}</p>`,
      `<h2>The problem</h2><p>${esc(d.problem)}</p>`,
      `<h2>What people said</h2>${themes}${f.themeCount > f.themes.length ? `<p class="muted">The ${f.themes.length} that matter most, of ${f.themeCount}.</p>` : ''}`,
      `<h2>Recommended directions</h2><p class="muted">The solutions and trade-offs are best guesses for the team to react to, not decisions.</p>${solutions}`,
      `<h2>Recommendation</h2><p>${esc(d.recommendation.direction)}</p><p><strong>The decision asked for.</strong> ${esc(d.recommendation.decision)}</p><p><strong>Next step.</strong> ${esc(d.recommendation.nextStep)}</p>`,
      `<p class="small muted" style="margin-top:18pt">A snapshot made ${esc(moment(at.toISOString()))} by Signal Flow. The storyboard was written ${esc(moment(d.generatedAt))}${d.source === 'template' ? ' as a plain draft, without the AI model, so the costs, risks and trade-offs are not estimated' : ''}. The research, and so this page, can change.</p>`,
    ].join('\n'),
  )
}

/** The published requirements document: the brief, then each section of the document. */
export function requirementsHtml(spec: SpecDetail, launchName: string, at: Date = new Date()): string {
  const b = spec.brief
  const sections = spec.document
    .map((s) => `<h2>${esc(s.heading)}</h2>${s.lines.length > 1 ? `<ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>` : s.lines.map((l) => `<p>${esc(l)}</p>`).join('')}`)
    .join('')
  return page(
    `${launchName}: requirements`,
    [
      `<p class="eyebrow">Requirements</p><h1>${esc(spec.name)}</h1><p class="meta">${esc(launchName)}${spec.publishedAt ? ` · published ${esc(moment(spec.publishedAt))}` : ''}</p>`,
      b.problem || b.users || b.goals?.length
        ? `<h2>The brief</h2>${b.problem ? `<p><strong>The problem.</strong> ${esc(b.problem)}</p>` : ''}${b.users ? `<p><strong>Who it is for.</strong> ${esc(b.users)}</p>` : ''}${b.goals?.length ? `<p><strong>Goals</strong></p><ul>${b.goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : ''}`
        : '',
      sections,
      `<p class="small muted" style="margin-top:18pt">A snapshot made ${esc(moment(at.toISOString()))} by Signal Flow from the published requirements. The launch in Signal Flow is always current.</p>`,
    ].join('\n'),
  )
}
