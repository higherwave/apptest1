// Typed client for the API. Types come from openapi/openapi.yaml (npm run gen:api); every function here
// is one operation in that spec, and the MCP data-binding check will match hooks to these names.
import type { components } from './schema'
import { getToken } from './token'

export type Project = components['schemas']['ProjectSummary']
export type ProjectTint = Project['color']
export type Me = components['schemas']['Me']

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
    /** On a 409, the version the project is at now. */
    public current?: { version: number },
  ) {
    super(message)
  }
}

type SendOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; token?: string | null; version?: number }

// Every request carries the editing token when the tab has one. 204 responses have no body.
async function request<T>(path: string, { method = 'GET', body, token, version }: SendOptions = {}): Promise<T> {
  const bearer = token === undefined ? getToken() : token
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(version !== undefined ? { 'if-match': String(version) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const parsed = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(res.status, parsed?.error?.code ?? 'unknown', parsed?.error?.message ?? res.statusText, parsed?.error?.field, parsed?.current)
  return parsed as T
}

export type Health = { status: 'ok'; time: string; version: string }
export type DatabaseHealth = { status: 'ok'; database: 'reachable'; migrations: number }

export const getHealth = () => request<Health>('/health')
export const getDatabaseHealth = () => request<DatabaseHealth>('/health/db')
export type AiStatus = components['schemas']['AiStatus']
export const getAiStatus = () => request<AiStatus>('/ai/status')
export const getMe = (token?: string | null) => request<Me>('/me', { token })
export type Template = components['schemas']['Template']
export type CreateProjectRequest = components['schemas']['CreateProjectRequest']
export const listTemplates = () => request<components['schemas']['TemplateList']>('/templates')
export const createProject = (input: CreateProjectRequest) => request<Project>('/projects', { method: 'POST', body: input })
export const deleteProject = (id: string) => request<null>(`/projects/${id}`, { method: 'DELETE' })
export type ProjectDetail = components['schemas']['ProjectDetail']
export type StageInfo = components['schemas']['StageInfo']
export type StepKey = keyof StageInfo['tabs']
export const getProject = (id: string) => request<ProjectDetail>(`/projects/${id}`)
export const getProjectStage = (id: string) => request<StageInfo>(`/projects/${id}/stage`)
// Saves send the version the person was looking at; a 409 means someone else saved first.
export const saveStudy = (id: string, version: number, body: components['schemas']['SavePlanRequest']) => request<ProjectDetail>(`/projects/${id}/study`, { method: 'PUT', body, version })
export const saveTasks = (id: string, version: number, body: components['schemas']['SaveTasksRequest']) => request<ProjectDetail>(`/projects/${id}/tasks`, { method: 'PUT', body, version })
export type TranscriptList = components['schemas']['TranscriptList']
export type AnalysisRunResult = components['schemas']['AnalysisRunResult']
export const getTranscripts = (id: string) => request<TranscriptList>(`/projects/${id}/transcripts`)
export const saveTranscripts = (id: string, version: number, body: components['schemas']['SaveTranscriptsRequest']) => request<TranscriptList>(`/projects/${id}/transcripts`, { method: 'PUT', body, version })
export const startAnalysis = (id: string, version: number) => request<AnalysisRunResult>(`/projects/${id}/analysis-runs`, { method: 'POST', body: {}, version })
export type Theme = components['schemas']['Theme']
export type ThemePatch = components['schemas']['ThemePatch']
export type ThemeList = components['schemas']['ThemeList']
export type ThemeCategory = Theme['category']
export const listThemes = (projectId: string) => request<ThemeList>(`/projects/${projectId}/themes?include=quotes`)
// An edit is checked against the version of that theme's edits, so edits to other themes never conflict.
export const updateTheme = (themeId: string, version: number, body: ThemePatch) => request<Theme>(`/themes/${themeId}`, { method: 'PATCH', body, version })
export const resetPriorityOverrides = (projectId: string) => request<{ data: Theme[] }>(`/projects/${projectId}/priority-overrides`, { method: 'DELETE' })
export type SpecDetail = components['schemas']['SpecDetail']
export type SpecSummary = components['schemas']['SpecSummary']
export type SpecStep = SpecDetail['steps'][number]
export type PublishResult = components['schemas']['PublishResult']
export const listSpecs = (filter: { projectId?: string; standalone?: boolean } = {}) =>
  request<{ data: SpecSummary[] }>(`/specs${filter.projectId ? `?projectId=${filter.projectId}` : filter.standalone ? '?standalone=true' : ''}`).then((r) => r.data)
export const getSpec = (id: string) => request<SpecDetail>(`/specs/${id}`)
export const createSpec = (projectId: string, name?: string) => request<SpecDetail>(`/projects/${projectId}/specs`, { method: 'POST', body: name ? { name } : {} })
export const createStandaloneSpec = (name: string, what: string) => request<SpecDetail>('/specs/standalone', { method: 'POST', body: { name, what } })
export const setSpecTheme = (specId: string, themeId: string, version: number, included: boolean) => request<SpecDetail>(`/specs/${specId}/themes/${themeId}`, { method: 'PUT', body: { included }, version })
// Step actions carry the step's own version, so two people reviewing the same step cannot both succeed.
export const approveStep = (stepId: string, version: number) => request<SpecDetail>(`/agent-steps/${stepId}/approve`, { method: 'POST', version })
export const redoStep = (stepId: string, version: number, instructions: string) => request<SpecDetail>(`/agent-steps/${stepId}/redo`, { method: 'POST', body: { instructions }, version })
export const editStep = (stepId: string, version: number, text: string) => request<SpecDetail>(`/agent-steps/${stepId}`, { method: 'PATCH', body: { text }, version })
export const publishSpec = (specId: string, version: number) => request<PublishResult>(`/specs/${specId}/publish`, { method: 'POST', version })
export const deleteSpec = (specId: string) => request<null>(`/specs/${specId}`, { method: 'DELETE' })
export const listProjects = () => request<components['schemas']['ProjectList']>('/projects').then((r) => r.data)

// What to tell a person for each error code the API can return.
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'db_unavailable') return 'The demo database is paused. It wakes on the next request, or when the monthly limit resets.'
    if (err.code === 'auth_not_configured') return 'Sign-in is not set up yet, so data routes are closed on this deployment.'
    if (err.code === 'unauthorized') return 'The access token was missing or not accepted.'
    if (err.code === 'forbidden') return 'Your role cannot make changes.'
    if (err.code === 'version_conflict') return 'Someone else changed this since you opened it. It has been reloaded.'
    if (err.code === 'not_found') return 'That project no longer exists.'
    if (err.code === 'no_transcripts') return 'Add at least one transcript before analyzing.'
    if (err.code === 'no_analysis') return 'Analyze the transcripts first: a document is built from the themes.'
    if (err.code === 'spec_published') return 'This document is published and can no longer be changed.'
    if (err.code === 'step_not_ready') return 'That step is not ready for this action yet.'
    if (err.code === 'steps_not_approved') return 'Every step must be approved before publishing.'
    if (err.code === 'no_board') return 'Publish a requirements document to put its stories on the board.'
    if (err.code === 'nothing_to_undo') return 'There is no move of yours to undo.'
    if (err.code === 'cannot_undo') return 'That card has moved again since, so the move cannot be undone.'
    if (err.code === 'theme_superseded') return 'These themes are from an earlier analysis. They have been reloaded.'
    if (err.code === 'workspace_not_found') return 'The demo data is not loaded yet.'
    return err.message
  }
  return 'The API did not respond.'
}

// The Stories board ---------------------------------------------------------------------------------
export type Board = components['schemas']['Board']
export type BoardStory = components['schemas']['BoardStory']
export type StoryDetail = components['schemas']['StoryDetail']
export type ChecklistItem = components['schemas']['ChecklistItem']
export type StoryStatus = BoardStory['status']
export type Priority = BoardStory['priority']
export type ChecklistInput = components['schemas']['SaveChecklistRequest']['items'][number]
export const getBoard = (projectId: string) => request<Board>(`/projects/${projectId}/board`)
export const getStory = (id: string) => request<StoryDetail>(`/stories/${id}`)
export const moveStory = (id: string, version: number, status: StoryStatus, beforeId: string | null) =>
  request<StoryDetail>(`/stories/${id}/move`, { method: 'POST', body: { status, beforeId }, version })
export const undoMove = (specId: string) => request<StoryDetail>(`/specs/${specId}/undo`, { method: 'POST' })
export const patchStory = (id: string, version: number, body: { ownerTeam?: string | null; priority?: Priority }) =>
  request<StoryDetail>(`/stories/${id}`, { method: 'PATCH', body, version })
export const saveChecklist = (id: string, version: number, items: ChecklistInput[]) =>
  request<StoryDetail>(`/stories/${id}/checklist`, { method: 'PUT', body: { items }, version })

// Platform Insights -----------------------------------------------------------------------------------
export type InsightsThemes = components['schemas']['InsightsThemes']
export type PlatformThemeRow = InsightsThemes['themes'][number]
export type InsightRecommendation = InsightsThemes['recommendations'][number]
export type PlatformThemeDetail = components['schemas']['PlatformThemeDetail']
export type CaseStudy = components['schemas']['CaseStudy']
export const getInsightsThemes = () => request<InsightsThemes>('/insights/themes')
export const getPlatformTheme = (id: string) => request<PlatformThemeDetail>(`/insights/themes/${id}`)
export const listCaseStudies = () => request<{ data: CaseStudy[] }>('/insights/case-studies').then((r) => r.data)
