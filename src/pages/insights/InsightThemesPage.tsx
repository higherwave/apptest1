import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useInsightsThemes, useMarkThemeReviewed, useMe, useThemeCuration } from '../../api/hooks'
import { InsightThemesView } from './InsightThemesView'

// Container: the cross-project themes. The open row lives in the address (?theme=), so a case study can link to one; with none asked for, the first is open.
export function InsightThemesPage() {
  const [params, setParams] = useSearchParams()
  const [closed, setClosed] = useState(false)
  const overview = useInsightsThemes()
  const me = useMe()
  const reviewed = useMarkThemeReviewed()
  const tidy = useThemeCuration()
  const actions = Object.values(tidy)
  const failed = actions.find((m) => m.isError)
  // A new action clears the last one's error.
  const run = (go: () => void) => () => {
    actions.forEach((m) => m.reset())
    go()
  }
  const themes = overview.data?.themes ?? []
  const asked = params.get('theme')
  const openId = closed ? null : themes.some((t) => t.id === asked) ? asked : (themes[0]?.id ?? null)

  const state = overview.isError ? 'error' : overview.isPending ? 'loading' : themes.length === 0 ? 'empty' : 'ready'
  return (
    <InsightThemesView
      state={state}
      overview={overview.data}
      openId={openId}
      errorText={overview.isError ? friendlyMessage(overview.error) : undefined}
      curation={{
        canEdit: me.data?.role === 'owner' || me.data?.role === 'editor',
        busy: actions.some((m) => m.isPending),
        error: failed ? friendlyMessage(failed.error) : undefined,
        onRename: (id, title) => run(() => tidy.rename.mutate({ id, title }))(),
        onMerge: (id, intoId) => run(() => tidy.merge.mutate({ id, intoId }))(),
        onFindDuplicates: run(() => tidy.find.mutate()),
        onAccept: (id) => run(() => tidy.accept.mutate(id))(),
        onDismiss: (id) => run(() => tidy.dismiss.mutate(id))(),
        onRationale: run(() => tidy.rationale.mutate()),
      }}
      canReview={me.data?.role === 'owner' || me.data?.role === 'editor'}
      reviewing={reviewed.isPending}
      onReviewed={(id) => reviewed.mutate(id)}
      onToggle={(id) => {
        if (id === openId) setClosed(true)
        else {
          setClosed(false)
          setParams({ theme: id }, { replace: true })
        }
      }}
    />
  )
}
