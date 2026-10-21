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
  ) {
    super(message)
  }
}

type SendOptions = { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown; token?: string | null }

// Every request carries the editing token when the tab has one. 204 responses have no body.
async function request<T>(path: string, { method = 'GET', body, token }: SendOptions = {}): Promise<T> {
  const bearer = token === undefined ? getToken() : token
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const parsed = res.status === 204 ? null : await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(res.status, parsed?.error?.code ?? 'unknown', parsed?.error?.message ?? res.statusText, parsed?.error?.field)
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
export const listProjects = () => request<components['schemas']['ProjectList']>('/projects').then((r) => r.data)

// What to tell a person for each error code the API can return.
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'db_unavailable') return 'The demo database is paused. It wakes on the next request, or when the monthly limit resets.'
    if (err.code === 'auth_not_configured') return 'Sign-in is not set up yet, so data routes are closed on this deployment.'
    if (err.code === 'unauthorized') return 'The access token was missing or not accepted.'
    if (err.code === 'forbidden') return 'Your role cannot make changes.'
    if (err.code === 'workspace_not_found') return 'The demo data is not loaded yet.'
    return err.message
  }
  return 'The API did not respond.'
}
