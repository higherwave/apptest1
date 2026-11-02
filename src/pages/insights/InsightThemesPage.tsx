import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useInsightsThemes, useMarkThemeReviewed, useMe } from '../../api/hooks'
import { InsightThemesView } from './InsightThemesView'

// Container: the cross-project themes. The open row lives in the address (?theme=), so a case study can link to one; with none asked for, the first is open.
export function InsightThemesPage() {
  const [params, setParams] = useSearchParams()
  const [closed, setClosed] = useState(false)
  const overview = useInsightsThemes()
  const me = useMe()
  const reviewed = useMarkThemeReviewed()
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
