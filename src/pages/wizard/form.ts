import type { CreateProjectRequest, ProjectDetail, Template } from '../../api/client'

// Form state and rules for the new-project wizard. No React in here, so it is easy to test.
export type TemplateKey = Template['key']
export type WizardParticipant = { id?: string; name: string; role: string; email: string; sessionDate: string }
export type WizardForm = {
  name: string
  templateKey: TemplateKey
  what: string
  jtbd: { when: string; want: string; so: string }
  outcomes: string[]
  methods: string[]
  participants: WizardParticipant[]
}
// Keyed the way the API names fields, for example 'name' or 'participants.0.email'.
export type FieldErrors = Record<string, string>

export const STEPS = ['Basics', 'Test plan', 'Participants'] as const
export const blankParticipant = (): WizardParticipant => ({ name: '', role: '', email: '', sessionDate: '' })

export const emptyForm = (): WizardForm => ({
  name: '', templateKey: 'usability', what: '', jtbd: { when: '', want: '', so: '' }, outcomes: [''], methods: [], participants: [blankParticipant()],
})

// Choosing a template fills the test plan with its defaults; the name and participants are kept.
export function applyTemplate(form: WizardForm, template: Template): WizardForm {
  return {
    ...form,
    templateKey: template.key,
    what: template.what,
    jtbd: { ...template.jtbd },
    outcomes: template.outcomes.length ? [...template.outcomes] : [''],
    methods: [...template.methods],
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const hasContent = (p: WizardParticipant) => [p.name, p.role, p.email, p.sessionDate].some((v) => v.trim())

export function validateStep(form: WizardForm, step: number): FieldErrors {
  const errors: FieldErrors = {}
  if (step === 0 && !form.name.trim()) errors.name = 'Enter a project name.'
  if (step === 2) {
    form.participants.forEach((p, i) => {
      if (!hasContent(p)) return
      if (!p.name.trim()) errors[`participants.${i}.name`] = 'Enter a name.'
      if (!p.email.trim()) errors[`participants.${i}.email`] = 'Enter an email address.'
      else if (!EMAIL.test(p.email.trim())) errors[`participants.${i}.email`] = 'Enter a valid email address.'
    })
    if (!form.participants.some((p) => p.name.trim() || p.email.trim()) && !Object.keys(errors).length) {
      errors['participants.0.name'] = 'Add at least one participant.'
      errors['participants.0.email'] = 'Enter an email address.'
    }
  }
  return errors
}

export function toRequest(form: WizardForm): CreateProjectRequest {
  return {
    name: form.name.trim(),
    templateKey: form.templateKey,
    what: form.what.trim() || null,
    jtbd: { when: form.jtbd.when.trim() || null, want: form.jtbd.want.trim() || null, so: form.jtbd.so.trim() || null },
    outcomes: form.outcomes.map((o) => o.trim()).filter(Boolean),
    methods: form.methods,
    participants: form.participants.filter(hasContent).map((p) => ({
      name: p.name.trim(), role: p.role.trim() || null, email: p.email.trim(), sessionDate: p.sessionDate || null,
    })),
  }
}

// Which wizard step shows an error the API reported for this field, so a server-side 422 can send the
// person back to the right step.
export function stepForField(field: string | undefined): number {
  if (!field) return 0
  if (field.startsWith('participants')) return 2
  if (field === 'name' || field === 'templateKey') return 0
  return 1
}

// Editing an existing project ------------------------------------------------------------------------

export const formFromProject = (p: ProjectDetail): WizardForm => ({
  name: p.name,
  templateKey: 'blank',
  what: p.study.what ?? '',
  jtbd: { when: p.study.jtbd.when ?? '', want: p.study.jtbd.want ?? '', so: p.study.jtbd.so ?? '' },
  outcomes: p.study.outcomes.length ? [...p.study.outcomes] : [''],
  methods: [...p.study.methods],
  participants: p.participants.length
    ? p.participants.map((x) => ({ id: x.id, name: x.name, role: x.role ?? '', email: x.email, sessionDate: x.sessionDate ?? '' }))
    : [blankParticipant()],
})

// The two parts of the Test Plan screen are saved separately, so each has its own "has it changed" check.
export const planPart = (f: WizardForm) => JSON.stringify([f.name.trim(), f.what.trim(), f.jtbd.when.trim(), f.jtbd.want.trim(), f.jtbd.so.trim(), f.outcomes.map((o) => o.trim()).filter(Boolean), [...f.methods].sort()])
export const participantsPart = (f: WizardForm) =>
  JSON.stringify(f.participants.filter(hasContent).map((p) => [p.id ?? null, p.name.trim(), p.role.trim(), p.email.trim().toLowerCase(), p.sessionDate]))

export const planChanged = (form: WizardForm, saved: ProjectDetail) => planPart(form) !== planPart(formFromProject(saved))
export const participantsChanged = (form: WizardForm, saved: ProjectDetail) => participantsPart(form) !== participantsPart(formFromProject(saved))

export function toPlanRequest(form: WizardForm) {
  const { name, what, jtbd, outcomes, methods } = toRequest(form)
  return { name, what, jtbd, outcomes, methods }
}
export function toParticipantsRequest(form: WizardForm) {
  return { participants: toRequest(form).participants.map((p, i) => ({ ...p, id: form.participants.filter(hasContent)[i].id ?? null })) }
}

// Task list --------------------------------------------------------------------------------------------

export type TaskForm = { prompt: string; followUps: string[] }[]
export const taskFormFromProject = (p: ProjectDetail): TaskForm => p.tasks.map((t) => ({ prompt: t.prompt, followUps: t.followUps.map((f) => f.prompt) }))
export const tasksKey = (t: TaskForm) => JSON.stringify(t.filter((x) => x.prompt.trim()).map((x) => [x.prompt.trim(), x.followUps.map((f) => f.trim()).filter(Boolean)]))
export const tasksChanged = (form: TaskForm, saved: ProjectDetail) => tasksKey(form) !== tasksKey(taskFormFromProject(saved))
export const toTasksRequest = (form: TaskForm) => ({ tasks: form.filter((t) => t.prompt.trim()).map((t) => ({ prompt: t.prompt.trim(), followUps: t.followUps.map((f) => f.trim()).filter(Boolean) })) })
