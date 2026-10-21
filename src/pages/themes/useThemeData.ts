import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { friendlyMessage, listThemes, resetPriorityOverrides, updateTheme, type Theme, type ThemeList, type ThemePatch } from '../../api/client'
import { applyPatch } from './themeEdits'

// The project's themes (with quotes) and the ways to change them. An edit shows at once, is sent with the version
// of that theme's edits, and settles with what the server returns. A theme with an edit in flight ignores further
// edits until it settles, so a quick second click never sends a stale version.
export function useThemeData(projectId: string) {
  const queryClient = useQueryClient()
  const key = ['themes', projectId]
  const themes = useQuery({ queryKey: key, queryFn: () => listThemes(projectId), enabled: !!projectId })
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | undefined>()

  const mapThemes = (fn: (t: Theme) => Theme) =>
    queryClient.setQueryData<ThemeList>(key, (old) => (old ? { ...old, data: old.data.map(fn) } : old))

  async function edit(theme: Theme, patch: ThemePatch) {
    if (pending.has(theme.id)) return
    setPending((p) => new Set(p).add(theme.id))
    setError(undefined)
    mapThemes((t) => (t.id === theme.id ? applyPatch(t, patch) : t))
    try {
      const saved = await updateTheme(theme.id, theme.overrideVersion, patch)
      mapThemes((t) => (t.id === theme.id ? { ...saved, quotes: t.quotes } : t))
    } catch (err) {
      setError(friendlyMessage(err))
      await queryClient.invalidateQueries({ queryKey: key })
    } finally {
      setPending((p) => {
        const n = new Set(p)
        n.delete(theme.id)
        return n
      })
    }
  }

  async function resetAll() {
    setError(undefined)
    try {
      await resetPriorityOverrides(projectId)
    } catch (err) {
      setError(friendlyMessage(err))
    }
    await queryClient.invalidateQueries({ queryKey: key })
  }

  return { themes, list: themes.data?.data ?? [], stages: themes.data?.stages ?? [], edit, resetAll, pending, error, clearError: () => setError(undefined) }
}
