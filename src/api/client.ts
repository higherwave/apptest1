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

type SendOptions = { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; token?: string | null; version?: number }

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
export const saveParticipants = (id: string, version: number, body: components['schemas']['SaveParticipantsRequest']) => request<ProjectDetail>(`/projects/${id}/participants`, { method: 'PUT', body, version })
export const saveTasks = (id: string, version: number, body: components['schemas']['SaveTasksRequest']) => request<ProjectDetail>(`/projects/${id}/tasks`, { method: 'PUT', body, version })
export type TranscriptList = components['schemas']['TranscriptList']
export type AnalysisRunResult = components['schemas']['AnalysisRunResult']
export const getTranscripts = (id: string) => request<TranscriptList>(`/projects/${id}/transcripts`)
export const saveTranscripts = (id: string, version: number, body: components['schemas']['SaveTranscriptsRequest']) => request<TranscriptList>(`/projects/${id}/transcripts`, { method: 'PUT', body, version })
export const startAnalysis = (id: string, version: number) => request<AnalysisRunResult>(`/projects/${id}/analysis-runs`, { method: 'POST', body: {}, version })
export const listProjects = () => request<components['schemas']['ProjectList']>('/projects').then((r) => r.data)

// What to tell a person for each error code the API can return.
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'db_unavailable') return 'The demo database is paused. It wakes on the next request, or when the monthly limit resets.'
    if (err.code === 'auth_not_configured') return 'Sign-in is not set up yet, so data routes are closed on this deployment.'
    if (err.code === 'unauthorized') return 'The access token was missing or not accepted.'
    if (err.code === 'forbidden') return 'Your role cannot make changes.'
    if (err.code === 'version_conflict') return 'Someone else changed this project since you opened it.'
    if (err.code === 'not_found') return 'That project no longer exists.'
    if (err.code === 'no_transcripts') return 'Add at least one transcript before analyzing.'
    if (err.code === 'workspace_not_found') return 'The demo data is not loaded yet.'
    return err.message
  }
  return 'The API did not respond.'
}
