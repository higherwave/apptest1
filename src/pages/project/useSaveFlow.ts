import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { ApiRequestError, friendlyMessage, type ProjectDetail } from '../../api/client'

// Runs a save and tracks what the person needs to see: saving, saved, a conflict with someone else's
// change, or an error. A conflict remembers the version to overwrite from; nothing is overwritten until
// the person chooses "Overwrite with mine".
export function useSaveFlow(projectId: string, current: ProjectDetail | undefined) {
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [conflictVersion, setConflictVersion] = useState<number | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [savedAt, setSavedAt] = useState<string | undefined>()

  // `run` receives the version to save against and returns the project as it is after saving.
  async function save(run: (version: number) => Promise<ProjectDetail>, overwrite = false): Promise<ProjectDetail | undefined> {
    if (!current) return undefined
    setSaving(true)
    setError(undefined)
    try {
      const saved = await run(overwrite && conflictVersion !== null ? conflictVersion : current.version)
      setConflictVersion(null)
      setSavedAt(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
      return saved
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'version_conflict') setConflictVersion(err.current?.version ?? current.version)
      else setError(friendlyMessage(err))
      return undefined
    } finally {
      setSaving(false)
    }
  }

  // Throws away the person's edits and shows what is saved now.
  async function reload(): Promise<ProjectDetail | undefined> {
    setConflictVersion(null)
    setError(undefined)
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    return queryClient.getQueryData<ProjectDetail>(['project', projectId])
  }

  return { saving, conflict: conflictVersion !== null, error, savedAt, save, reload, clearError: () => setError(undefined) }
}
