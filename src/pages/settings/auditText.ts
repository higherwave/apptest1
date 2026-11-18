import type { AuditEntry, AuditGroup } from '../../api/client'
import { T } from '../../../shared/terms.mjs'

// The words the audit log uses for what changed. No React in here, so it is easy to test.
export const GROUP_LABEL: Record<AuditGroup, string> = {
  members: 'People and roles',
  teams: 'Teams',
  reviewers: `Launch ${T.approvers}`,
  launches: 'Launches',
  categories: 'Experience categories',
  projects: 'Projects',
  workflows: 'Journeys',
  jira: 'Jira hand-offs',
  data: 'Data downloads',
}

const ENTITY_LABEL: Record<string, string> = {
  'core.memberships': 'Member',
  'core.teams': 'Team',
  'core.team_memberships': 'Team member',
  'core.reviewer_assignments': `Launch ${T.approver}`,
  'core.team_launch_steps': 'Launch steps',
  'delivery.launches': 'Launch',
  'delivery.launch_answers': 'Launch answer',
  'delivery.launch_links': 'Launch link',
  'insights.feature_areas': 'Experience category',
  'core.projects': 'Project',
  'delivery.specs': 'Requirements',
  'core.workspaces': 'Workspace data',
  'core.legal_holds': 'Legal hold',
  'core.workspace_setup': 'Workspace setup',
  'insights.workflows': 'Journey',
  'delivery.story_tickets': 'Jira ticket',
}
export const entityLabel = (entity: string) => ENTITY_LABEL[entity] ?? entity

/** The verb as a phrase: "analysis_run" reads "Analysis run". */
export const verbLabel = (verb: string) => {
  const text = verb.replace(/_/g, ' ').trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** A field name as words: stagesMapped reads "stages mapped". */
const words = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase()
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
    const parts = keys.slice(0, 3).map((k) => `${words(k)}: ${show(b[k])} → ${show(a[k])}`)
    return parts.join(' · ') + (keys.length > 3 ? ' · …' : '')
  }
  const o = a ?? b
  if (!o) return ''
  // A workflow save lists what it changed, one line each.
  if (Array.isArray(o.changes)) return o.changes.map(String).join(' · ')
  const keys = [...FIRST.filter((k) => k in o), ...Object.keys(o).filter((k) => !FIRST.includes(k))].slice(0, 3)
  return keys.map((k) => `${words(k)}: ${show(o[k])}`).join(' · ')
}

export const describe = (e: Pick<AuditEntry, 'entity' | 'verb' | 'before' | 'after'>) => ({ what: `${entityLabel(e.entity)} · ${verbLabel(e.verb)}`, detail: auditDetail(e.before, e.after) })

// The date filter on the audit log: a few presets, each a starting moment ("All time" has none). "Today" starts at midnight where the person is.
export type AuditRange = 'all' | 'today' | '7d' | '30d' | '90d'
export const AUDIT_RANGES: { key: AuditRange; label: string }[] = [
  { key: 'all', label: 'All time' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
]
const DAYS: Record<Exclude<AuditRange, 'all' | 'today'>, number> = { '7d': 7, '30d': 30, '90d': 90 }

/** The moment a range starts, as an ISO time to send as `since`; undefined for "All time". */
export function sinceFor(range: AuditRange, now: Date = new Date()): string | undefined {
  if (range === 'all') return undefined
  if (range === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  return new Date(now.getTime() - DAYS[range] * 86_400_000).toISOString()
}
