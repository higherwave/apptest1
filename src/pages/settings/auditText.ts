import type { AuditEntry, AuditGroup } from '../../api/client'

// The words the audit log uses for what changed. No React in here, so it is easy to test.
export const GROUP_LABEL: Record<AuditGroup, string> = {
  members: 'People and roles',
  categories: 'Experience categories',
  projects: 'Projects',
  workflows: 'Workflows',
  jira: 'Jira hand-offs',
}

const ENTITY_LABEL: Record<string, string> = {
  'core.memberships': 'Member',
  'insights.feature_areas': 'Experience category',
  'core.projects': 'Project',
  'insights.workflows': 'Workflow',
  'insights.workflow_stages': 'Workflow stage',
  'insights.workflow_backstage': 'Backstage entry',
  'delivery.story_tickets': 'Jira ticket',
}
export const entityLabel = (entity: string) => ENTITY_LABEL[entity] ?? entity

/** The verb as a phrase: "analysis_run" reads "Analysis run". */
export const verbLabel = (verb: string) => {
  const text = verb.replace(/_/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const FIRST = ['name', 'title', 'email', 'summary', 'jiraKey']
const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const show = (v: unknown) => {
  const text = v === null || v === undefined ? 'none' : typeof v === 'object' ? JSON.stringify(v) : String(v)
  return text.length > 80 ? `${text.slice(0, 79)}…` : text
}

/** What the change was, in a line: the fields that differ (before → after), or the main fields of what was made or removed. */
export function auditDetail(before: unknown, after: unknown): string {
  const b = asObject(before)
  const a = asObject(after)
  if (b && a) {
    const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])].filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    const parts = keys.slice(0, 3).map((k) => `${k}: ${show(b[k])} → ${show(a[k])}`)
    return parts.join(' · ') + (keys.length > 3 ? ' · …' : '')
  }
  const o = a ?? b
  if (!o) return ''
  const keys = [...FIRST.filter((k) => k in o), ...Object.keys(o).filter((k) => !FIRST.includes(k))].slice(0, 3)
  return keys.map((k) => `${k}: ${show(o[k])}`).join(' · ')
}

export const describe = (e: Pick<AuditEntry, 'entity' | 'verb' | 'before' | 'after'>) => ({ what: `${entityLabel(e.entity)} · ${verbLabel(e.verb)}`, detail: auditDetail(e.before, e.after) })
