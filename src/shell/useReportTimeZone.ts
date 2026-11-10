import { useEffect } from 'react'
import { useMe, useNotificationPreferences, useSaveNotificationPreferences } from '../api/hooks'

// The daily reminder arrives at 6am where the person is, so the browser tells the server its time zone once, the first time it is not known.
// After that the person's own choice in Settings stands: this never overwrites a zone that is already saved.
export function useReportTimeZone() {
  const me = useMe()
  const eligible = !!me.data && me.data.via !== 'anonymous' && (me.data.role === 'owner' || me.data.role === 'editor')
  const prefs = useNotificationPreferences(eligible)
  const { mutate } = useSaveNotificationPreferences()
  const zone = prefs.data?.timeZone
  const known = prefs.isSuccess
  useEffect(() => {
    if (!eligible || !known || zone) return
    let here: string | undefined
    try {
      here = Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      here = undefined
    }
    if (here) mutate({ timeZone: here })
  }, [eligible, known, zone, mutate])
}
