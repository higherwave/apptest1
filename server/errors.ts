// One error envelope for every failure: { error: { code, message, field? } }.
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 428 | 500 | 503,
    public code: string,
    message: string,
    public field?: string,
    /** Extra top-level fields in the response body, for example the current version on a 409. */
    public extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export const envelope = (code: string, message: string, field?: string, extra?: Record<string, unknown>) => ({
  error: { code, message, ...(field ? { field } : {}) },
  ...(extra ?? {}),
})
