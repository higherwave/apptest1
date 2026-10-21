// One error envelope for every failure: { error: { code, message, field? } }.
export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 500 | 503,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message)
  }
}

export const envelope = (code: string, message: string, field?: string) => ({
  error: { code, message, ...(field ? { field } : {}) },
})
