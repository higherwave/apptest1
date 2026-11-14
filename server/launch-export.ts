// The launch record as a page that prints: where the launch stands, every step's answer with its reason, who gave it and when, the links each step
// carries, and the brief with its requirements. It is a snapshot (a launch keeps changing), so it says when it was made. The HTML is complete in itself
// (inline styles, no fonts or pictures fetched) so the PDF service never needs the network; every piece of user text is escaped. Pure: no I/O.
import { answerLabel } from '../shared/launch.mjs'
import type { LaunchDetail, LaunchStep } from './launches.js'

const STATE: Record<string, string> = {
  preparing: 'Preparing', waiting: 'Waiting', missing: 'Approver missing', not_used: 'Not used', reopened: 'Reopened', ready: 'Ready',
  ready_with_conditions: 'Ready with conditions', changes_needed: 'Changes needed', not_applicable: 'Not applicable', go: 'Go', go_with_conditions: 'Go with conditions', no_go: 'No-go',
}
const stateLabel = (s: string) => STATE[s] ?? s
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null)
const moment = (iso: string) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'
// A link that does not start with http(s) is shown as text, never as a clickable address.
const link = (url: string, title: string) => (/^https?:\/\//i.test(url) ? `<a href="${esc(url)}">${esc(title || url)}</a>` : esc(title || url))
const tone = (s: string) => (['ready', 'go'].includes(s) ? 'good' : ['ready_with_conditions', 'go_with_conditions'].includes(s) ? 'cond' : ['changes_needed', 'no_go', 'missing'].includes(s) ? 'bad' : s === 'reopened' ? 'reopened' : 'plain')

const STYLE = `
  @page { size: Letter; margin: 0.8in 0.8in 0.9in; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2933; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  h1 { font-size: 22pt; margin: 0 0 4pt; line-height: 1.15; }
  h2 { font-size: 13pt; margin: 22pt 0 8pt; padding-bottom: 4pt; border-bottom: 1px solid #d6dbe0; break-after: avoid; }
  h3 { font-size: 11pt; margin: 0; }
  p { margin: 0 0 6pt; }
  .eyebrow { font-size: 8.5pt; letter-spacing: 0.08em; text-transform: uppercase; color: #5c6773; margin: 0 0 6pt; }
  .meta { color: #5c6773; margin: 0 0 14pt; }
  .standing { border-radius: 8pt; padding: 12pt 14pt; background: #f1f3f5; }
  .standing.good { background: #e3f4ea; } .standing.cond { background: #e1f1f0; } .standing.bad { background: #fbe5e1; } .standing.reopened { background: #f1e8f7; }
  .big { font-size: 18pt; font-weight: 600; margin: 0 0 4pt; }
  .step { border: 1px solid #d6dbe0; border-radius: 8pt; padding: 10pt 12pt; margin: 0 0 8pt; break-inside: avoid; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 12pt; margin-bottom: 4pt; }
  .tag { font-size: 8.5pt; font-weight: 600; border-radius: 10pt; padding: 1pt 8pt; background: #e8ebee; white-space: nowrap; }
  .tag.good { background: #cfeedd; } .tag.cond { background: #cdeae8; } .tag.bad { background: #f6cfc8; } .tag.reopened { background: #e5d6f1; }
  .by { color: #5c6773; font-size: 9pt; }
  .why { margin: 4pt 0; }
  .muted { color: #5c6773; }
  ul { margin: 4pt 0; padding-left: 16pt; }
  table { width: 100%; border-collapse: collapse; font-size: 10pt; }
  th, td { text-align: left; padding: 4pt 6pt; border-bottom: 1px solid #e3e7ea; vertical-align: top; }
  th { font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.06em; color: #5c6773; }
  a { color: #0b5cad; text-decoration: none; }
  .small { font-size: 9pt; }
`

function stepHtml(s: LaunchStep): string {
  const state = s.used ? s.state : 'not_used'
  const reviewers = [...s.reviewers.primary].map((p) => p.name).join(', ')
  const a = s.answer
  const parts: string[] = [`<div class="head"><h3>${esc(s.label)}</h3><span class="tag ${tone(state)}">${esc(stateLabel(state))}</span></div>`]
  if (!s.used) parts.push('<p class="muted">This team’s launches do not use this step.</p>')
  else if (a) {
    parts.push(`<p class="by">${esc(a.by?.name ?? 'Someone')} · ${esc(moment(a.at))}${a.reopened ? ' · the brief has changed since, so this needs confirming' : ''}</p>`)
    parts.push(a.rationale ? `<p class="why">${esc(a.rationale)}</p>` : '<p class="muted">No reason was needed.</p>')
    if (a.openItems?.length) parts.push(`<p class="small muted">Went past these open steps:</p><ul>${a.openItems.map((i) => `<li><strong>${esc(i.label)}</strong> (${esc(stateLabel(i.state).toLowerCase())})${i.rationale ? `: ${esc(i.rationale)}` : ''}</li>`).join('')}</ul>`)
  } else parts.push(`<p class="muted">${s.state === 'missing' ? 'No reviewer is set up for this step.' : `Waiting for ${esc(reviewers || 'its reviewer')}.`}</p>`)
  if (s.links.length) parts.push(`<p class="small muted">Links</p><ul>${s.links.map((l) => `<li>${link(l.url, l.title)}</li>`).join('')}</ul>`)
  if (s.earlier.length) parts.push(`<p class="small muted">Earlier answers</p><ul class="small">${s.earlier.map((e) => `<li>${esc(answerLabel(e.answer))}, ${esc(e.by?.name ?? 'someone')}, ${esc(moment(e.at))}${e.rationale ? `: ${esc(e.rationale)}` : ''}</li>`).join('')}</ul>`)
  return `<section class="step" data-step="${esc(s.step)}">${parts.join('')}</section>`
}

/** The whole document for a launch as it stands at `at`. */
export function launchRecordHtml(launch: LaunchDetail, at: Date = new Date()): string {
  const s = launch.summary
  const standingTone = s.state === 'no_go' || s.blocking.length ? 'bad' : s.state === 'go' ? 'good' : s.state === 'go_with_conditions' ? 'cond' : s.state === 'reopened' ? 'reopened' : 'plain'
  const counts = [
    [s.counts.ready, 'ready'], [s.counts.conditions, 'ready with conditions'], [s.counts.notApplicable, 'not applicable'], [s.counts.changes, 'changes needed'],
    [s.counts.reopened, 'reopened'], [s.counts.waiting, 'waiting'], [s.counts.missing, 'approver missing'],
  ].filter(([n]) => (n as number) > 0).map(([n, l]) => `${n} ${l}`)
  const b = launch.brief
  const meta = [launch.projectName, launch.teamName, day(launch.targetDate) ? `Target ${day(launch.targetDate)}` : null].filter(Boolean).join(' · ')
  const body = [
    `<p class="eyebrow">Launch record</p><h1>${esc(launch.name)}</h1><p class="meta">${esc(meta)}</p>`,
    `<div class="standing ${standingTone}"><p class="eyebrow">Where it stands</p><p class="big">${esc(stateLabel(s.state))}</p>${counts.length ? `<p>${esc(counts.join(' · '))}</p>` : ''}` +
      (s.blocking.length ? `<p class="eyebrow" style="margin-top:8pt">Holding it back</p><ul>${s.blocking.map((x) => `<li>${esc(x.label)}: ${esc(stateLabel(x.state).toLowerCase())}</li>`).join('')}</ul>` : '') +
      (s.waitingOn.length ? `<p class="eyebrow" style="margin-top:8pt">Waiting on</p><ul>${s.waitingOn.map((x) => `<li>${esc(x.label)}</li>`).join('')}</ul>` : '') + '</div>',
    '<h2>The decisions</h2>',
    ...launch.steps.map(stepHtml),
    '<h2>The brief</h2>',
    b.published
      ? [
          b.problem ? `<p><strong>The problem.</strong> ${esc(b.problem)}</p>` : '',
          b.users ? `<p><strong>Who it is for.</strong> ${esc(b.users)}</p>` : '',
          b.goals?.length ? `<p><strong>Goals</strong></p><ul>${b.goals.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>` : '',
        ].join('')
      : '<p class="muted">The requirements are not published yet, so there is no brief.</p>',
    launch.briefNotes ? `<p><strong>Notes for this launch.</strong></p><p style="white-space:pre-wrap">${esc(launch.briefNotes)}</p>` : '',
    b.published && b.requirements.length ? `<h2>The requirements</h2><table><thead><tr><th>Key</th><th>Requirement</th><th>Priority</th></tr></thead><tbody>${b.requirements.map((r) => `<tr><td>${esc(r.key)}</td><td>${esc(r.title)}</td><td>${esc(r.priority)}</td></tr>`).join('')}</tbody></table>` : '',
    `<p class="small muted" style="margin-top:18pt">A snapshot made ${esc(moment(at.toISOString()))} by Signal Flow from the launch record. The record can change after this; the launch in Signal Flow is always current. The brief last changed ${esc(moment(launch.briefAt))}.</p>`,
  ].join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(launch.name)}: launch record</title><style>${STYLE}</style></head><body>${body}</body></html>`
}

/** A file name fit for a download: letters, digits and hyphens. */
export const exportFileName = (launch: Pick<LaunchDetail, 'name'>, ext: string) =>
  `${launch.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'launch'}-launch-record.${ext}`
