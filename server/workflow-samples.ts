// The example a workspace can start from (the "Add the Anchor CX example" button on Platform Insights > Journey): the blueprint of Anchor CX, the made-up
// customer-success platform whose research story the demo tells (db/seed/anchor-cx/README.md). The stages carry the same names as that story's journey
// stages, so its three studies go on the workflow and map to it by name. Everything here is invented: the teams, systems and owners are what Anchor CX's
// blueprint could look like, not data about any real organisation.
import type { WorkflowInput } from './workflows.js'

type S = [name: string, good: string, signal: string, handoff: string, backstage: [kind: 'Team' | 'System' | 'Process', name: string, owner: string][]]
const build = (name: string, description: string, stages: S[]): WorkflowInput => ({
  name,
  description,
  stages: stages.map(([sName, good, signal, handoff, backstage]) => ({
    id: null, name: sName, good, signal, handoff,
    backstage: backstage.map(([kind, bName, owner]) => ({ id: null, kind, name: bName, owner })),
  })),
})

export const SAMPLE_WORKFLOWS: WorkflowInput[] = [
  build('Customer success lifecycle', 'How a customer-success team prepares for a customer, judges account health, spots risk, hands a case to the right team, and renews and reports.', [
    ['Prepare for a customer', 'A customer success manager goes into a check-in knowing the account’s history, health and open issues without opening another tool.', 'Minutes spent preparing a check-in; tabs and tools opened per account.', 'The prepared account view goes into the manager’s check-in notes.', [
      ['System', 'Customer 360 timeline', 'Platform Data'], ['System', 'CRM and contract sync', 'Integrations'], ['Team', 'CS Operations', 'Customer Success']]],
    ['Judge account health', 'The health score shows why it changed, in words a manager trusts.', 'Support tickets asking why a score changed; scores overridden by hand.', 'A score and its drivers feed the risk alerts.', [
      ['System', 'Health score engine', 'Data Science'], ['System', 'Usage and ticket signal pipeline', 'Data Platform'], ['Process', 'Quarterly score model review', 'CS Operations']]],
    ['Spot risk early', 'Alerts arrive early enough to act on, and are quiet enough to trust.', 'Alerts muted or ignored; renewals lost with no earlier alert.', 'A risk alert opens a case with its context attached.', [
      ['System', 'Risk alert service', 'Platform Engineering'], ['Team', 'Support leads', 'Support Operations'], ['Process', 'Alert threshold tuning', 'CS Operations']]],
    ['Hand off to the right team', 'Support and success pass a case along with its context, and nothing is retold.', 'Escalations missed by the manager; cases reopened for missing context.', 'The receiving team sees the timeline and what has already been tried.', [
      ['System', 'Support ticketing integration', 'Integrations'], ['Team', 'Support and success operations', 'Customer Operations'], ['Process', 'Escalation rules by segment', 'Support Operations']]],
    ['Renew and report', 'A renewal is prepared from one workspace and reported to leadership without a manual spreadsheet.', 'Hours spent on manual reporting; renewals with no prepared playbook.', 'Renewal outcomes and the portfolio report reach the executives.', [
      ['System', 'Renewal playbook engine', 'Product Engineering'], ['System', 'Reporting and export service', 'Data Platform'], ['Team', 'CS Operations', 'Customer Success']]],
  ]),
]
