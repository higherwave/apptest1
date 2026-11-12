import type { Workflow, WorkflowRequest } from '../../api/client'

// The workflow being edited, as the editor holds it: text in plain strings, a key on every row so React keeps the right inputs when rows move.
// No React in here, so it is easy to test. `id` is null for a stage or entry that does not exist yet.
export type BackstageKind = 'Team' | 'System' | 'Process'
export const KINDS: BackstageKind[] = ['Team', 'System', 'Process']
export type DraftBackstage = { key: string; id: string | null; kind: BackstageKind; name: string; owner: string }
export type DraftStage = { key: string; id: string | null; name: string; good: string; signal: string; handoff: string; backstage: DraftBackstage[] }
export type Draft = { id: string | null; version: number; name: string; description: string; stages: DraftStage[] }

let counter = 0
const nextKey = () => `k${++counter}`

export const MAX_STAGES = 12
export const MAX_BACKSTAGE = 12

export const blankStage = (name = ''): DraftStage => ({ key: nextKey(), id: null, name, good: '', signal: '', handoff: '', backstage: [] })
export const blankDraft = (): Draft => ({ id: null, version: 0, name: '', description: '', stages: [blankStage('Stage 1')] })

export const fromWorkflow = (w: Workflow): Draft => ({
  id: w.id,
  version: w.version,
  name: w.name,
  description: w.description ?? '',
  stages: w.stages.map((s) => ({
    key: nextKey(), id: s.id, name: s.name, good: s.good ?? '', signal: s.signal ?? '', handoff: s.handoff ?? '',
    backstage: s.backstage.map((b) => ({ key: nextKey(), id: b.id, kind: b.kind, name: b.name, owner: b.owner ?? '' })),
  })),
})

export const addStage = (d: Draft): Draft => (d.stages.length >= MAX_STAGES ? d : { ...d, stages: [...d.stages, blankStage(`Stage ${d.stages.length + 1}`)] })
export const removeStage = (d: Draft, key: string): Draft => (d.stages.length <= 1 ? d : { ...d, stages: d.stages.filter((s) => s.key !== key) })
export function moveStage(d: Draft, key: string, by: -1 | 1): Draft {
  const i = d.stages.findIndex((s) => s.key === key)
  const j = i + by
  if (i < 0 || j < 0 || j >= d.stages.length) return d
  const stages = [...d.stages]
  ;[stages[i], stages[j]] = [stages[j], stages[i]]
  return { ...d, stages }
}
export const patchStage = (d: Draft, key: string, patch: Partial<Omit<DraftStage, 'key' | 'id' | 'backstage'>>): Draft => ({ ...d, stages: d.stages.map((s) => (s.key === key ? { ...s, ...patch } : s)) })
export const addBackstage = (d: Draft, stageKey: string, kind: BackstageKind = 'Team'): Draft => ({
  ...d,
  stages: d.stages.map((s) => (s.key === stageKey && s.backstage.length < MAX_BACKSTAGE ? { ...s, backstage: [...s.backstage, { key: nextKey(), id: null, kind, name: '', owner: '' }] } : s)),
})
export const patchBackstage = (d: Draft, stageKey: string, key: string, patch: Partial<Pick<DraftBackstage, 'kind' | 'name' | 'owner'>>): Draft => ({
  ...d,
  stages: d.stages.map((s) => (s.key === stageKey ? { ...s, backstage: s.backstage.map((b) => (b.key === key ? { ...b, ...patch } : b)) } : s)),
})
export const removeBackstage = (d: Draft, stageKey: string, key: string): Draft => ({ ...d, stages: d.stages.map((s) => (s.key === stageKey ? { ...s, backstage: s.backstage.filter((b) => b.key !== key) } : s)) })

const text = (s: string) => (s.trim() ? s.trim() : null)

/** What the person still has to fix before it can be saved: a name for the workflow, every stage and every backstage entry. */
export function problems(d: Draft): string[] {
  const out: string[] = []
  if (d.name.trim().length < 2) out.push('Give the journey a name of at least 2 characters.')
  if (d.stages.some((s) => !s.name.trim())) out.push('Give every stage a name.')
  if (d.stages.some((s) => s.backstage.some((b) => !b.name.trim()))) out.push('Give every backstage entry a name.')
  return out
}

export const toRequest = (d: Draft): WorkflowRequest => ({
  name: d.name.trim(),
  description: text(d.description),
  stages: d.stages.map((s) => ({
    id: s.id, name: s.name.trim(), good: text(s.good), signal: text(s.signal), handoff: text(s.handoff),
    backstage: s.backstage.map((b) => ({ id: b.id, kind: b.kind, name: b.name.trim(), owner: text(b.owner) })),
  })),
})

/** Whether the draft differs from what was loaded (what a save would send, compared). */
export const isDirty = (d: Draft, original: Draft): boolean => JSON.stringify(toRequest(d)) !== JSON.stringify(toRequest(original))
