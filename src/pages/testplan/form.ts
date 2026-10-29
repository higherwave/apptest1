import type { CreateProjectRequest, ProjectDetail } from '../../api/client'

// Form state and rules for the test plan page (new and existing projects). No React in here, so it is easy to test.
export type PlanParticipant = { id?: string; name: string; role: string; email: string; phone: string; sessionMinutes: string }
export type PlanItem = { description: string; outcomes: string[] }
export type PlanForm = { name: string; methods: string[]; testItems: PlanItem[]; participants: PlanParticipant[] }
// Keyed the way the API names fields, for example 'name' or 'participants.0.email'.
export type FieldErrors = Record<string, string>

// The planned length of a session, as the preset choices the plan offers. The value is minutes as text, '' meaning not chosen yet.
export const SESSION_LENGTHS = [
  { value: '30', label: '30 min' },
  { value: '45', label: '45 min' },
  { value: '60', label: '1 hour' },
] as const

export const blankParticipant = (): PlanParticipant => ({ name: '', role: '', email: '', phone: '', sessionMinutes: '' })
export const blankItem = (): PlanItem => ({ description: '', outcomes: [''] })
export const emptyForm = (): PlanForm => ({ name: '', methods: [], testItems: [blankItem()], participants: [blankParticipant()] })

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const hasContent = (p: PlanParticipant) => [p.name, p.role, p.email, p.phone, p.sessionMinutes].some((v) => v.trim())
const cleanOutcomes = (outcomes: string[]) => outcomes.map((o) => o.trim()).filter(Boolean)
const cleanItems = (items: PlanItem[]) => items.map((i) => ({ description: i.description.trim(), outcomes: cleanOutcomes(i.outcomes) })).filter((i) => i.description || i.outcomes.length)

export function validate(form: PlanForm): FieldErrors {
  const errors: FieldErrors = {}
  if (!form.name.trim()) errors.name = 'Enter a project name.'
  form.participants.forEach((p, i) => {
    if (!hasContent(p)) return
    if (!p.name.trim()) errors[`participants.${i}.name`] = 'Enter a name.'
    if (!p.email.trim()) errors[`participants.${i}.email`] = 'Enter an email address.'
    else if (!EMAIL.test(p.email.trim())) errors[`participants.${i}.email`] = 'Enter a valid email address.'
  })
  if (!form.participants.some((p) => p.name.trim() || p.email.trim()) && !Object.keys(errors).some((k) => k.startsWith('participants'))) {
    errors['participants.0.name'] = 'Add at least one participant.'
    errors['participants.0.email'] = 'Enter an email address.'
  }
  return errors
}

const participantRequests = (form: PlanForm) =>
  form.participants.filter(hasContent).map((p) => ({
    id: p.id ?? null, name: p.name.trim(), role: p.role.trim() || null, email: p.email.trim(), phone: p.phone.trim() || null, sessionMinutes: p.sessionMinutes ? (Number(p.sessionMinutes) as 30 | 45 | 60) : null,
  }))
const itemRequests = (form: PlanForm) => cleanItems(form.testItems).map((i) => ({ description: i.description || null, outcomes: i.outcomes }))

export function toRequest(form: PlanForm): CreateProjectRequest {
  return { name: form.name.trim(), methods: form.methods, testItems: itemRequests(form), participants: participantRequests(form).map(({ id: _id, ...p }) => p) }
}

// Editing an existing project ------------------------------------------------------------------------

export const formFromProject = (p: ProjectDetail): PlanForm => ({
  name: p.name,
  methods: [...p.study.methods],
  testItems: p.testItems.length ? p.testItems.map((i) => ({ description: i.description ?? '', outcomes: i.outcomes.length ? [...i.outcomes] : [''] })) : [blankItem()],
  participants: p.participants.length
    ? p.participants.map((x) => ({ id: x.id, name: x.name, role: x.role ?? '', email: x.email, phone: x.phone ?? '', sessionMinutes: x.sessionMinutes ? String(x.sessionMinutes) : '' }))
    : [blankParticipant()],
})

// What the save would send, so "has it changed" ignores blank rows, spacing and the order methods were ticked in.
const planKey = (f: PlanForm) => JSON.stringify([f.name.trim(), [...f.methods].sort(), itemRequests(f), participantRequests(f).map((p) => ({ ...p, email: p.email.toLowerCase() }))])
export const planChanged = (form: PlanForm, saved: ProjectDetail) => planKey(form) !== planKey(formFromProject(saved))

export const toPlanRequest = (form: PlanForm) => ({ name: form.name.trim(), methods: form.methods, testItems: itemRequests(form), participants: participantRequests(form) })

// Task list --------------------------------------------------------------------------------------------

export type TaskForm = { prompt: string; followUps: string[] }[]
export const taskFormFromProject = (p: ProjectDetail): TaskForm => p.tasks.map((t) => ({ prompt: t.prompt, followUps: t.followUps.map((f) => f.prompt) }))
export const tasksKey = (t: TaskForm) => JSON.stringify(t.filter((x) => x.prompt.trim()).map((x) => [x.prompt.trim(), x.followUps.map((f) => f.trim()).filter(Boolean)]))
export const tasksChanged = (form: TaskForm, saved: ProjectDetail) => tasksKey(form) !== tasksKey(taskFormFromProject(saved))
export const toTasksRequest = (form: TaskForm) => ({ tasks: form.filter((t) => t.prompt.trim()).map((t) => ({ prompt: t.prompt.trim(), followUps: t.followUps.map((f) => f.trim()).filter(Boolean) })) })
