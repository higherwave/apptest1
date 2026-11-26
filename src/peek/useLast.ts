import { useState } from 'react'

// The last non-null value, so a drawer that is closing keeps showing what it showed while it slides out.
export function useLast<T>(value: T | null): T | null {
  const [last, setLast] = useState<T | null>(value)
  if (value !== null && value !== last) setLast(value)
  return value ?? last
}
