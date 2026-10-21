// Typed client for the API. Types come from openapi/openapi.yaml (npm run gen:api); every function here
// is one operation in that spec, and the MCP data-binding check will match hooks to these names.
import type { components } from './schema'

export type Project = components['schemas']['ProjectSummary']
export type ProjectTint = Project['color']
export type Me = components['schemas']['Me']

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new ApiRequestError(res.status, body?.error?.code ?? 'unknown', body?.error?.message ?? res.statusText)
  return body as T
}

export type Health = { status: 'ok'; time: string; version: string }
export type DatabaseHealth = { status: 'ok'; database: 'reachable'; migrations: number }

export const getHealth = () => request<Health>('/health')
export const getDatabaseHealth = () => request<DatabaseHealth>('/health/db')
export const getMe = () => request<Me>('/me')
export const listProjects = () => request<components['schemas']['ProjectList']>('/projects').then((r) => r.data)

// What to tell a person for each error code the API can return.
export function friendlyMessage(err: unknown): string {
  if (err instanceof ApiRequestError) {
    if (err.code === 'db_unavailable') return 'The demo database is paused. It wakes on the next request, or when the monthly limit resets.'
    if (err.code === 'auth_not_configured' || err.code === 'unauthorized') return 'Sign-in is not set up yet, so data routes are closed on this deployment.'
    if (err.code === 'workspace_not_found') return 'The demo data is not loaded yet.'
    return err.message
  }
  return 'The API did not respond.'
}
