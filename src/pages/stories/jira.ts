import type { StoryDetail } from '../../api/client'

// The simulated Jira connection: the projects and people a ticket can be given to. Nothing here comes from Jira yet.
export const SIM_PROJECTS = ['PLAT · Platform', 'CSX · Customer Success']
export const SIM_ASSIGNEES = ['Unassigned', 'Dana Whitfield', 'Marcus Lee', 'Priya Nair']
export const ISSUE_TYPES = ['Story', 'Task', 'Epic']
export const PRIORITIES = ['High', 'Medium', 'Low']

export const priorityLabel = (p: string) => p.charAt(0).toUpperCase() + p.slice(1)

// A label from the theme's title: "The customer timeline saves real time" becomes "the-customer-timeline-saves-real-time".
export const labelFrom = (themeTitle: string | undefined) => (themeTitle ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// What goes into a ticket's description, worked out from the story: the statement, the acceptance criteria, why it matters, the next
// step, and where the evidence is (the link back to this story, when one is given).
export function ticketBody(story: Pick<StoryDetail, 'summary' | 'whyItMatters' | 'nextStep' | 'checklist' | 'theme'>, link?: string): string {
  const criteria = story.checklist.filter((c) => c.kind === 'criterion')
  const parts = [
    story.summary,
    criteria.length ? `Acceptance criteria\n${criteria.map((c) => `• ${c.text}`).join('\n')}` : null,
    story.whyItMatters ? `Why it matters\n${story.whyItMatters}` : null,
    story.nextStep ? `Next step\n${story.nextStep}` : null,
    story.theme || link
      ? `Evidence\n${[story.theme ? `Raised by ${story.theme.participantCount} of ${story.theme.totalParticipants} participants (${story.theme.title}).` : null, link ? `Source: ${link}` : null].filter(Boolean).join(' ')}`
      : null,
  ]
  return parts.filter((p): p is string => !!p).join('\n\n')
}

// The same, as Markdown for pasting into a comment or a document.
export const storyMarkdown = (story: Pick<StoryDetail, 'key' | 'title'> & Parameters<typeof ticketBody>[0], link?: string) => `## ${story.key} — ${story.title}\n\n${ticketBody(story, link)}`

// What the Readiness list checks before a story goes to Jira. None of these blocks sending: they say what is still thin.
export function readiness(story: Pick<StoryDetail, 'summary' | 'checklist' | 'nextStep'>): { ok: boolean; label: string }[] {
  const criteria = story.checklist.filter((c) => c.kind === 'criterion').length
  return [
    { ok: !!story.summary?.trim(), label: 'Story statement' },
    { ok: criteria > 0, label: criteria === 1 ? '1 acceptance criterion' : criteria > 0 ? `${criteria} acceptance criteria` : 'Acceptance criteria' },
    { ok: true, label: 'Priority set' },
    { ok: !!story.nextStep?.trim(), label: 'Next step defined' },
  ]
}
