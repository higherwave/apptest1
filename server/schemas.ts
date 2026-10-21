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
