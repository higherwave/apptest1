import { readingText, sentenceText } from '../../../shared/measure.mjs'

type Verdict = 'worked' | 'needs_attention' | 'too_early'
type Measure = {
  metricKind: string
  detail: string | null
  comparison: string
  valueA: string | null
  valueB: string | null
  unit: string | null
  result: Verdict | null
  checkins: { on: string; value: string; verdict: Verdict; note: string | null }[]
}
type Project = { projectName: string; teamName: string | null; ownerName: string | null; approvedOn: string | null; measures: Measure[] }
type Theme = { title: string; projects: Project[] }

const WORDS: Record<Verdict, string> = { worked: 'worked', needs_attention: 'needs attention', too_early: 'too early to tell' }
const ORDER: Record<Verdict, number> = { worked: 0, needs_attention: 1, too_early: 2 }
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })

/** "3 worked, 1 needs attention, 1 too early to tell across 2 projects": the one sentence at the top of a theme. Only results that exist are named. */
export function themeSummaryLine(theme: Theme): string {
  const count = (v: Verdict) => theme.projects.reduce((n, p) => n + p.measures.filter((m) => m.result === v).length, 0)
  const parts = (['worked', 'needs_attention', 'too_early'] as Verdict[]).filter((v) => count(v) > 0).map((v) => `${count(v)} ${WORDS[v]}`)
  const projects = theme.projects.length
  return `${parts.join(', ')} across ${projects} ${projects === 1 ? 'project' : 'projects'}`
}

/** A theme's results as plain text for a report or a message: the summary line, then each project and each measure with what was expected and what was read. Worked first. */
export function themeSummaryText(theme: Theme): string {
  const lines = [theme.title, `${themeSummaryLine(theme)}.`]
  for (const p of theme.projects) {
    lines.push('', [p.projectName, [p.teamName, p.ownerName, p.approvedOn ? `signed off ${day(p.approvedOn)}` : null].filter(Boolean).join(', ')].filter(Boolean).join(' · '))
    const sorted = [...p.measures].sort((a, b) => (a.result ? ORDER[a.result] : 3) - (b.result ? ORDER[b.result] : 3))
    for (const m of sorted) {
      const last = m.checkins[m.checkins.length - 1]
      const read = last ? `${readingText(last.value, m.unit) || 'no value'} as of ${day(last.on)}${last.note ? `. ${last.note.replace(/\.+$/, '')}` : ''}` : 'not read yet'
      lines.push(`- ${m.result ? `${WORDS[m.result][0].toUpperCase()}${WORDS[m.result].slice(1)}` : 'Not read'}: ${sentenceText(m) || 'Not described.'} Read: ${read}.`.replace(/\s+/g, ' '))
    }
  }
  return lines.join('\n')
}
