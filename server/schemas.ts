import { z } from 'zod'
import { ApiError } from './errors.js'

// Request bodies. The OpenAPI spec describes the same shapes; the contract tests keep them in step.
export const TINTS = ['cream', 'mint', 'yellow', 'coral', 'lavender', 'sky', 'blue', 'rose', 'peach', 'sand'] as const

export const METHOD_OPTIONS = [
  'Moderated usability test', 'Unmoderated test', 'Contextual interview', 'Diary study', 'Concept test', 'Card sort', 'Survey follow-up',
] as const

// Journey stages every new study starts with; they are editable per study later.
export const DEFAULT_STAGES = ['Find a provider', 'Book a time', 'Confirm & pay', 'Prepare or change', 'Visit & follow-up'] as const

const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) => text(max).transform((v) => (v === '' ? null : v)).nullish().transform((v) => v ?? null)

export const participantSchema = z.object({
  name: text(120).min(1, 'Enter a name.'),
  role: optionalText(160),
  email: z.string().trim().min(1, 'Enter an email address.').pipe(z.email('Enter a valid email address.')),
  phone: optionalText(40),
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.').nullish().transform((v) => v ?? null),
})

// A test item: what is being tested and what the team expects to learn. An item with neither is dropped.
export const testItemSchema = z.object({
  description: optionalText(1000),
  outcomes: z.array(text(300)).default([]).transform((a) => a.filter(Boolean)),
})
const testItems = z
  .array(testItemSchema)
  .max(20, 'A test plan can hold up to 20 test items.')
  .default([])
  .transform((a) => a.filter((i) => i.description || i.outcomes.length))

export const createProjectSchema = z.object({
  name: text(120).min(1, 'Enter a project name.'),
  templateKey: z.enum(['usability', 'discovery', 'concept', 'blank']).default('blank'),
  methods: z.array(z.enum(METHOD_OPTIONS)).default([]),
  testItems,
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

// Saving the test plan page: name, methods, test items and participants in one save. An existing participant keeps its
// id, so transcript speakers matched to it stay matched. Tasks have their own save.
export const savePlanSchema = z.object({
  name: text(120).min(1, 'Enter a project name.'),
  methods: z.array(z.enum(METHOD_OPTIONS)).default([]),
  testItems,
  participants: z.array(participantSchema.extend({ id: z.uuid().nullish().transform((v) => v ?? null) })).min(1, 'Add at least one participant.'),
})
export type SavePlanInput = z.infer<typeof savePlanSchema>

export const saveTasksSchema = z.object({
  tasks: z.array(z.object({ prompt: text(500).min(1, 'Enter the question.'), followUps: z.array(text(500)).default([]).transform((a) => a.filter(Boolean)) })).max(50),
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
})
export const changeRoleSchema = z.object({ role: z.enum(['owner', 'editor', 'viewer']) })
