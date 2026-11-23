import { test } from 'node:test'
import assert from 'node:assert/strict'
import { themeSummaryLine, themeSummaryText } from './summaryText'

const reading = (verdict: 'worked' | 'needs_attention' | 'too_early', value: string, note: string | null = null) => ({ on: '2027-01-05', value, verdict, note })
const measure = (over: Record<string, unknown>) => ({ metricKind: 'adoption', detail: 'accounts opening the explanation', comparison: 'reach', valueA: '60', valueB: null, unit: '% within 60 days', result: null, checkins: [], ...over }) as never
const theme = {
  title: 'The health score can’t be explained',
  projects: [
    { projectName: 'Health score trust', teamName: 'Customer Success', ownerName: 'Alex Rivera', approvedOn: '2026-09-18', measures: [
      measure({ metricKind: 'engagement', detail: 'alerts muted', comparison: 'change', valueA: '70%', valueB: '30%', unit: '', result: 'too_early', checkins: [reading('too_early', '52%', 'Falling.')] }),
      measure({ result: 'worked', checkins: [reading('worked', '64')] }),
    ] },
    { projectName: 'Renewal workspace', teamName: null, ownerName: null, approvedOn: null, measures: [measure({ result: 'needs_attention', checkins: [reading('needs_attention', '20')] })] },
  ],
}

test('the summary line names only the results there are, and the projects', () => {
  assert.equal(themeSummaryLine(theme), '1 worked, 1 needs attention, 1 too early to tell across 2 projects')
  assert.equal(themeSummaryLine({ title: 't', projects: [theme.projects[0]] }), '1 worked, 1 too early to tell across 1 project')
})

test('the text version has the theme, the summary, then each project with its measures, worked first, with what was expected and what was read', () => {
  const text = themeSummaryText(theme)
  const lines = text.split('\n')
  assert.equal(lines[0], 'The health score can’t be explained')
  assert.equal(lines[1], '1 worked, 1 needs attention, 1 too early to tell across 2 projects.')
  assert.match(text, /Health score trust · Customer Success, Alex Rivera, signed off Sep 18, 2026/)
  assert.ok(text.indexOf('- Worked:') < text.indexOf('- Too early to tell:'), 'worked before too early')
  assert.match(text, /- Worked: We'll know this worked when Adoption accounts opening the explanation reach 60 % within 60 days\. Read: 64 % within 60 days as of Jan 5, 2027\./)
  assert.match(text, /as of Jan 5, 2027\. Falling\.$/m)
  assert.match(text, /Renewal workspace\n- Needs attention:/)
})
