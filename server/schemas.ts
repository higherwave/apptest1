import { z } from 'zod'
import { ApiError } from './errors.js'

// Request bodies. The OpenAPI spec describes the same shapes; the contract tests keep them in step.
export const TINTS = ['cream', 'mint', 'yellow', 'coral', 'lavender', 'sky', 'blue', 'rose', 'peach', 'sand'] as const

export const METHOD_OPTIONS = ['Contextual (walk-through)', 'User Discussions', 'Usability Test', 'Support or CSM channels', 'Survey'] as const

// Journey stages every new study starts with; they are editable per study later.
// The journey stages every new project starts with. Neutral on purpose: the Platform Insights journey folds stages with the same name together
// across projects, so shared, general names roll up well, and a project can rename them to fit its own story.
export const DEFAULT_STAGES = ['Discover', 'Explore', 'Decide', 'Deliver', 'Follow up'] as const

const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) => text(max).transform((v) => (v === '' ? null : v)).nullish().transform((v) => v ?? null)

export const participantSchema = z.object({
  name: text(120).min(1, 'Enter a name.'),
  role: optionalText(160),
  email: z.string().trim().min(1, 'Enter an email address.').pipe(z.email('Enter a valid email address.')),
  phone: optionalText(40),
  sessionMinutes: z.union([z.literal(30), z.literal(45), z.literal(60)], 'Choose 30 minutes, 45 minutes or 1 hour.').nullish().transform((v) => v ?? null),
})

// The project description: a short, high-level orientation for the whole project. Specifics live in the Test Plan's What to ask or observe tab.
const projectDescription = optionalText(2000)

export const createProjectSchema = z.object({
  name: text(120).min(1, 'Enter a project name.'),
  templateKey: z.enum(['usability', 'discovery', 'concept', 'blank']).default('blank'),
  methods: z.array(z.enum(METHOD_OPTIONS)).default([]),
  description: projectDescription,
  teamId: z.string().uuid().optional(),
  participants: z.array(participantSchema).min(1, 'Add at least one participant.'),
})
export type CreateProjectInput = z.infer<typeof createProjectSchema>

// Turns a validation failure into the API's 422 envelope, naming the first failing field.
export function parseBody<T extends z.ZodType>(schema: T, body: unknown): z.output<T> {
  const result = schema.safeParse(body)
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const field = issue.path.map(String).join('.')
  throw new ApiError(422, 'validation_failed', issue.message, field || undefined)
}

// Saving the test plan page: name, methods, description and participants in one save. An existing participant keeps its
// id, so transcript speakers matched to it stay matched. Tasks have their own save.
export const savePlanSchema = z.object({
  name: text(120).min(1, 'Enter a project name.'),
  methods: z.array(z.enum(METHOD_OPTIONS)).default([]),
  description: projectDescription,
  participants: z.array(participantSchema.extend({ id: z.uuid().nullish().transform((v) => v ?? null) })).min(1, 'Add at least one participant.'),
})
export type SavePlanInput = z.infer<typeof savePlanSchema>

export const saveTasksSchema = z.object({
  tasks: z.array(z.object({ prompt: text(500).min(1, 'Enter the question.'), areaId: z.uuid().nullish().transform((v) => v ?? null), followUps: z.array(text(500)).default([]).transform((a) => a.filter(Boolean)) })).max(50),
})
export type SaveTasksInput = z.infer<typeof saveTasksSchema>

export const PLATFORMS = ['zoom', 'meet', 'teams'] as const
export const saveTranscriptsSchema = z.object({
  transcripts: z
    .array(
      z.object({
        id: z.uuid().nullish().transform((v) => v ?? null),
        name: text(200).min(1, 'Enter a name.'),
        platform: z.enum(PLATFORMS).nullish().transform((v) => v ?? null),
        source: z.enum(['customer', 'team']).nullish().transform((v) => v ?? 'customer'),
        rawText: z.string().min(1, 'Paste or upload the transcript text.').max(500_000, 'This transcript is too long (500,000 characters at most).'),
      }),
    )
    .max(20, 'A project can hold up to 20 transcripts.'),
})
export type SaveTranscriptsInput = z.infer<typeof saveTranscriptsSchema>

// Edits to one theme. A key left out is untouched; null clears that edit (back to the analysis's suggestion).
const level = z.enum(['low', 'medium', 'high'])
export const themePatchSchema = z
  .object({
    title: text(200).transform((v) => (v === '' ? null : v)).nullable().optional(),
    stagePosition: z.number().int().min(0, 'Choose a stage.').nullable().optional(),
    priority: level.nullable().optional(),
    effort: z.number().int().min(1).max(3).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one change.')
export type ThemePatchInput = z.infer<typeof themePatchSchema>
export const THEME_CATEGORIES = ['pain_point', 'need', 'expectation', 'delight'] as const

// Requirements documents -----------------------------------------------------------------------------------
export const createSpecSchema = z.object({ name: text(120).optional() })
export const standaloneSpecSchema = z.object({
  name: text(120).min(1, 'Enter a name for the document.'),
  what: text(1000).min(1, 'Describe what you are specifying.'),
})
export const boardSyncSchema = z.object({ apply: z.boolean().optional() })
export const includeThemeSchema = z.object({ included: z.boolean() })
export const redoSchema = z.object({ instructions: text(500).min(1, 'Tell the agent what to change.') })
export const editStepSchema = z.object({ text: z.string().trim().min(1, 'The text cannot be empty.').max(5000, 'The text is too long.') })

// The board -----------------------------------------------------------------------------------------------------
export const moveStorySchema = z.object({
  status: z.enum(['todo', 'in_progress', 'in_review', 'done']),
  beforeId: z.uuid().nullish().transform((v) => v ?? null),
})
export const patchStorySchema = z
  .object({
    ownerTeam: text(120).transform((v) => (v === '' ? null : v)).nullable().optional(),
    priority: z.enum(['low', 'medium', 'high']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one change.')
export const checklistSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.uuid().nullish().transform((v) => v ?? null),
        kind: z.enum(['criterion', 'task']),
        text: text(300).min(1, 'Enter the text.'),
        met: z.boolean(),
      }),
    )
    .max(50, 'A card can hold up to 50 checklist items.'),
})

// Members: an owner invites an email with a role, changes a role, or removes someone.
export const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(['owner', 'editor', 'viewer']),
  /** From outside the company (outside counsel, a partner): a viewer whose access is limited to the launches they are asked to review. */
  external: z.boolean().optional(),
})
export const notificationPrefsSchema = z.object({ digestEnabled: z.boolean().optional(), timeZone: z.string().min(1).max(64).optional() })
export const teamMemberRoleSchema = z.object({ role: z.enum(['owner', 'editor', 'viewer']) })
export const changeRoleSchema = z
  .object({ role: z.enum(['owner', 'editor', 'viewer']).optional(), external: z.boolean().optional() })
  .refine((v) => v.role !== undefined || v.external !== undefined, 'Choose a role or whether the member is external.')

// A launch (one per project): its setup, a reviewer's answer to a step, and a link to evidence.
const LAUNCH_ANSWERS = ['ready', 'ready_with_conditions', 'changes_needed', 'not_applicable', 'go', 'go_with_conditions', 'no_go'] as const
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-12-01.').refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'That is not a date.')
export const createLaunchSchema = z.object({
  name: z.string().trim().max(120).optional(),
  targetDate: isoDay.nullish().transform((v) => v ?? null),
  briefNotes: z.string().max(8000).optional(),
})
export const setUpLaunchSchema = z.object({
  name: z.string().trim().min(1, 'A launch needs a name.').max(120).optional(),
  targetDate: isoDay.nullable().optional(),
  briefNotes: z.string().max(8000).optional(),
})
export const launchAnswerSchema = z.object({ answer: z.enum(LAUNCH_ANSWERS), rationale: z.string().trim().max(4000).default('') })
export const launchLinkSchema = z.object({ title: z.string().trim().max(120).optional(), url: z.string().trim().min(1, 'Enter a link.').max(2000) })

// Launch reviewers (Admin, Members, Reviewers): a person, the steps they approve, the teams they cover (all, or named), primary or alternate.
const LAUNCH_STEP_KEYS = ['product_leadership', 'sales', 'legal', 'documentation', 'marketing', 'final_decision'] as const
export const addReviewerSchema = z.object({
  memberId: z.uuid(),
  steps: z.array(z.enum(LAUNCH_STEP_KEYS)).min(1, 'Choose at least one step.').max(6),
  teams: z.union([z.literal('all'), z.array(z.uuid()).min(1, 'Choose at least one team.').max(200)]),
  role: z.enum(['primary', 'alternate']),
})
// Which optional steps a team's launches use; the final decision always applies.
export const teamStepsSchema = z.object({ used: z.partialRecord(z.enum(['product_leadership', 'sales', 'legal', 'documentation', 'marketing']), z.boolean()) })
export const addFollowersSchema = z.object({ userIds: z.array(z.string().uuid()).min(1).max(50) })
export const shareDigestSchema = z.object({ email: z.boolean(), slack: z.boolean() })
export const teamSlackSchema = z.object({ channel: z.string().max(80).nullable() })
export const teamNameSchema = z.object({ name: z.string().trim().min(1, 'Enter a team name.').max(60) })

// A measure row: how we will know a requirement worked, and the check-ins made since. Check-ins are kept oldest first.
export const measureSchema = z.object({
  metric: optionalText(300),
  source: z.enum(['telemetry', 'kpi', 'support_tickets', 'research', 'other']).nullish().transform((v) => v ?? null),
  baseline: optionalText(200),
  target: optionalText(200),
  // The sentence the row is entered as; when metricKind is sent, metric, baseline and target are written from these.
  metricKind: z.enum(['tickets', 'adoption', 'engagement', 'time_to_value', 'retention', 'feedback', 'other']).nullish().transform((v) => v ?? null),
  detail: optionalText(300),
  comparison: z.enum(['change', 'below', 'above', 'between', 'reach']).nullish().transform((v) => v ?? null),
  valueA: optionalText(60),
  valueB: optionalText(60),
  unit: optionalText(40),
  checkins: z
    .array(
      z.object({
        on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.'),
        value: text(2000),
        verdict: z.enum(['worked', 'needs_attention', 'too_early']),
        note: optionalText(1000),
      }),
    )
    .max(60, 'There are too many check-ins for one requirement.'),
})

// A design row: where the prototype is, what it looks like, and the notes. The picture is a small downscaled image sent as base64
// (at most about 600 KB of it); leaving `image` out keeps the current one, null removes it.
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
// POST /stories/:id/design/capture. `replace` lets the capture overwrite a picture a person uploaded (the Capture button; the automatic
// capture after a link is saved never sets it).
export const captureSchema = z.object({ replace: z.boolean().optional() }).default({})
// Adding an experience category. `force` is for a name that only resembles an existing area, when the person meant it.
export const createAreaSchema = z.object({
  name: text(60).min(2, 'Give the category a name of at least 2 characters.'),
  definition: optionalText(300),
  aliases: z.array(text(60)).max(12, 'Keep to 12 alternative names.').default([]),
  force: z.boolean().default(false),
})
export const updateAreaSchema = createAreaSchema.omit({ force: true })
export const mergeAreaSchema = z.object({ intoId: z.uuid('Choose the category to merge into.') })

export const acceptProposalSchema = z.object({ key: text(60), name: optionalText(60) })
export const dismissProposalSchema = z.object({ key: text(60) })
export const themeAreaSchema = z.object({ areaId: z.uuid().nullable() })

// A workflow (the service blueprint): saved whole, each stage with what good looks like, the signal to watch, the handoff and its backstage.
const optionalId = z.uuid().nullish().transform((v) => v ?? null)
export const workflowSchema = z.object({
  name: text(80).min(2, 'Give the workflow a name of at least 2 characters.'),
  description: optionalText(400),
  stages: z
    .array(
      z.object({
        id: optionalId,
        name: text(80).min(1, 'Give every stage a name.'),
        good: optionalText(300),
        signal: optionalText(300),
        handoff: optionalText(300),
        backstage: z
          .array(z.object({ id: optionalId, kind: z.enum(['Team', 'System', 'Process']), name: text(100).min(1, 'Give every backstage entry a name.'), owner: optionalText(100) }))
          .max(12, 'Keep to 12 backstage entries a stage.')
          .default([]),
      }),
    )
    .min(1, 'A workflow needs at least one stage.')
    .max(12, 'Keep to 12 stages.'),
})
export const projectWorkflowSchema = z.object({ workflowId: z.uuid().nullable() })
export const mapStageSchema = z.object({ position: z.number().int().min(0).max(50), workflowStageId: z.uuid().nullable() })

// A simulated Jira ticket made from a requirement. Everything is what a person chose in the Create ticket dialog.
export const createTicketSchema = z.object({
  // Only the simulation uses `project` (a connected Jira has the one project from its settings).
  project: text(80).regex(/^[A-Z][A-Z0-9]{1,9} · .{1,60}$/, 'Choose a project.').optional(),
  issueType: text(60).min(1),
  summary: text(255).min(1, 'A summary is required.'),
  description: text(20000).default(''),
  priority: text(40).min(1),
  assignee: text(80).min(1).default('Unassigned'),
  assigneeId: optionalText(80),
  labels: text(200).default(''),
  points: optionalText(6), // no longer sent by the dialog; kept so an older client still works
})

export const designSchema = z.object({
  prototypeUrl: text(2000)
    .refine((v) => v === '' || /^https?:\/\/[^\s]+$/i.test(v), 'Enter a link that starts with http:// or https://.')
    .transform((v) => (v === '' ? null : v))
    .nullish()
    .transform((v) => v ?? null),
  notes: optionalText(4000),
  image: z
    .object({ type: z.enum(IMAGE_TYPES), data: z.string().max(820_000, 'The picture is too large.').regex(/^[A-Za-z0-9+/]+={0,2}$/, 'The picture is not valid.') })
    .nullable()
    .optional(),
})
