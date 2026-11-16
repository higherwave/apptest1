export function sealSecret(env: Record<string, string | undefined>, plaintext: string): string
export function openSecret(env: Record<string, string | undefined>, sealed: string | null | undefined): string | null
