// How the System usage tab words its figures. No React in here, so it is easy to test.
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export const LEVEL_LABEL = { half: '50% reached', high: '80% reached', reached: 'Limit reached' } as const

export const share = (used: number, limit: number) => Math.round((used / Math.max(limit, 1)) * 100)
