import type { ApprovalPerson, ApprovalsOverview } from '../../api/client'
import { T } from '../../../shared/terms.mjs'

// Pure rules the Approvals screen uses, so they can be tested without a browser.

/**
 * Who would cover for this person if they were marked away: for each step they approve (for the workspace, or for a team of their own), the backup in the
 * same place who is not away. Empty when they approve nothing, or when any of those steps has no such backup (the Use backup toggle is then disabled, and
 * the server refuses it too).
 */
export function backupsFor(o: ApprovalsOverview, userId: string): ApprovalPerson[] {
  const found = new Map<string, ApprovalPerson>()
  let approves = false
  for (const step of o.steps) {
    if (step.approver?.userId === userId) {
      approves = true
      if (!step.backup || step.backup.unavailable || step.backup.userId === userId) return []
      found.set(step.backup.userId, step.backup)
    }
    for (const t of step.teams) {
      if (t.mode === 'custom' && t.approver?.userId === userId) {
        approves = true
        if (!t.backup || t.backup.unavailable || t.backup.userId === userId) return []
        found.set(t.backup.userId, t.backup)
      }
    }
  }
  return approves ? [...found.values()] : []
}

export type TeamDraft = { mode: 'default' | 'custom' | 'off'; approver: string; backup: string }

/** What a team ends up with for a step, from the panel's draft: the person who approves, or why nobody does. */
export function draftResult(workspaceApprover: string, draft: TeamDraft, optional: boolean): { kind: 'off' | 'approver' | 'gap'; userId?: string } {
  if (draft.mode === 'off' && optional) return { kind: 'off' }
  const id = draft.mode === 'custom' ? draft.approver : workspaceApprover
  return id ? { kind: 'approver', userId: id } : { kind: 'gap' }
}

/** Whether the panel's draft can be saved: a backup needs an approver, a team's own setting needs its approver, and nobody is their own backup. */
export function draftProblem(approver: string, backup: string, teams: Record<string, TeamDraft>): string | null {
  if (backup && !approver) return `Choose ${T.a('approver')} before ${T.a('backup')}.`
  if (approver && approver === backup) return `The ${T.approver} and the ${T.backup} must be different people.`
  for (const t of Object.values(teams)) {
    if (t.mode !== 'custom') continue
    if (!t.approver) return `Choose ${T.a('approver')} for each team that has its own.`
    if (t.approver === t.backup) return `A team’s ${T.approver} and ${T.backup} must be different people.`
  }
  return null
}
