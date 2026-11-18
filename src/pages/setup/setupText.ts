import { T } from '../../../shared/terms.mjs'

export type SetupKey = 'people' | 'approvals' | 'categories' | 'connections' | 'guard'

// What each setup category says about itself. The order is the order of the path.
export const SETUP: Record<SetupKey, { title: string; desc: string; who: string; welcome: string[] }> = {
  people: {
    title: 'Teams and people',
    desc: 'Name your teams and invite the people who will work in them, with the right access.',
    who: 'Workspace owner · about 5 minutes',
    welcome: ['A team owns projects, and each person has a role in each team.', 'Nobody gets in without an invitation, so invite the people who should have access.', 'Every team needs at least one person who can edit.'],
  },
  approvals: {
    title: T.Approvals,
    desc: `Choose who signs off on each launch step, and who covers when they are away.`,
    who: 'Workspace owner · about 5 minutes',
    welcome: [`Each step of a launch needs an ${T.approver}: product, legal, documentation and the rest.`, `Name a ${T.backup} where you can, so a launch does not wait on someone who is away.`, `A step nobody covers shows as a gap on every launch, so it is worth closing now.`],
  },
  categories: {
    title: 'Experience categories',
    desc: 'Name the parts of your product so research findings land in the right place.',
    who: 'Owner or editor · about 5 minutes',
    welcome: ['Categories are one shared set of words for what research is about.', 'Accept the suggestions you recognise, rename them, or add your own.', 'Give each a one-line definition when you can, so people file things the same way. It is not required to carry on.'],
  },
  connections: {
    title: 'Connections',
    desc: 'Connect Slack for launch threads and Jira for tickets. Optional, and easy to add later.',
    who: 'Workspace owner · optional',
    welcome: ['Slack carries the conversation about a launch, in a channel for each team. Signal Flow keeps the decisions.', 'Jira receives a ticket for each requirement when you send it.', 'These connections are set up with us at the start of a pilot. You can skip this now and come back.'],
  },
  guard: {
    title: 'Data and AI',
    desc: 'See how long things are kept, what the monthly AI limit is, and what the project lock means.',
    who: 'Workspace owner · read and confirm',
    welcome: ['Three rules the workspace runs on. Nothing to set here, only to read.', 'You can find each of them again under Admin later.'],
  },
}

export const ORDER: SetupKey[] = ['people', 'approvals', 'categories', 'connections', 'guard']
export const STEPS = ['Welcome', 'Set up', 'Review', 'Done'] as const

// The three things the last category asks an owner to read and confirm.
export const GUARD_ITEMS = [
  {
    title: 'How long things are kept',
    text: 'A deleted project or document stays in the Trash for 90 days, then is removed for good. The audit log and the record of AI use are kept for 12 months. An owner can download everything at any time (Admin, Data).',
    confirm: 'I have read how long things are kept',
  },
  {
    title: 'The monthly AI limit',
    text: 'The AI has a spending limit for this workspace each month. When it is reached, the steps that use it pause until the next month or an owner raises the limit. You can see the limit and what has been used under Admin, Usage and costs.',
    confirm: 'I know where the AI limit is',
  },
  {
    title: 'The project lock',
    text: `Once a project's requirements are published, the project is locked: its transcripts, themes and requirements no longer change, because ${T.approvers} and engineers are working from them. A workspace owner or the final ${T.approver} can return the requirements to draft until the first Jira ticket is created. After that it stays locked.`,
    confirm: 'I understand the project lock',
  },
]
