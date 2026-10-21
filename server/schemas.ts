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
  sessionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.').nullish().transform((v) => v ?? null),
})

export const createProjectSchema = z.object({
  name: text(120).min(1, 'Enter a project name.'),
  templateKey: z.enum(['usability', 'discovery', 'concept', 'blank']),
  what: optionalText(1000),
  jtbd: z.object({ when: optionalText(300), want: optionalText(300), so: optionalText(300) }).default({ when: null, want: null, so: null }),
  outcomes: z.array(text(300)).default([]).transform((a) => a.filter(Boolean)),
  methods: z.array(z.enum(METHOD_OPTIONS)).default([]),
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

// Saving the test plan: the fields of the wizard's first two steps. Participants and tasks have their own saves.
export const savePlanSchema = z.object({
  name: text(120).min(1, 'Enter a project name.'),
  what: optionalText(1000),
  jtbd: z.object({ when: optionalText(300), want: optionalText(300), so: optionalText(300) }).default({ when: null, want: null, so: null }),
  outcomes: z.array(text(300)).default([]).transform((a) => a.filter(Boolean)),
  methods: z.array(z.enum(METHOD_OPTIONS)).default([]),
})
export type SavePlanInput = z.infer<typeof savePlanSchema>

// An existing participant keeps its id, so transcript speakers matched to it stay matched.
export const saveParticipantsSchema = z.object({
  participants: z.array(participantSchema.extend({ id: z.uuid().nullish().transform((v) => v ?? null) })).min(1, 'Add at least one participant.'),
})
export type SaveParticipantsInput = z.infer<typeof saveParticipantsSchema>

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
    pinned: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Send at least one change.')
export type ThemePatchInput = z.infer<typeof themePatchSchema>
export const THEME_CATEGORIES = ['pain_point', 'need', 'expectation', 'delight'] as const
