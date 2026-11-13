import { useState } from 'react'
import { ApiRequestError, friendlyMessage } from '../../api/client'
import { useAddLaunchLink, useAnswerLaunchStep, useLaunch, useRemoveLaunchLink, useSetUpLaunch } from '../../api/hooks'
import { LaunchView } from './LaunchView'

// Container: one launch, as the signed-in person may see it, and the changes they may make to it. Used for a project's Launch step and for a launch
// opened by its address (a reviewer from another team, an external reviewer).
export function LaunchScreen({ launchId }: { launchId: string }) {
  const launch = useLaunch(launchId)
  const answer = useAnswerLaunchStep()
  const addLink = useAddLaunchLink()
  const removeLink = useRemoveLaunchLink()
  const setUp = useSetUpLaunch()
  const [error, setError] = useState<string | undefined>()
  const run = async (fn: () => Promise<unknown>) => {
    setError(undefined)
    try {
      await fn()
      return true
    } catch (err) {
      setError(friendlyMessage(err))
      return false
    }
  }
  const missing = launch.error instanceof ApiRequestError && launch.error.status === 404
  return (
    <LaunchView
      state={launch.isError ? 'error' : launch.isPending ? 'loading' : 'ready'}
      launch={launch.data}
      errorText={launch.isError ? (missing ? 'This launch is not available to you.' : friendlyMessage(launch.error)) : error}
      busy={answer.isPending || addLink.isPending || removeLink.isPending || setUp.isPending}
      onAnswer={(step, key, rationale) => run(() => answer.mutateAsync({ id: launchId, step, body: { answer: key as never, rationale } }))}
      onAddLink={(step, title, url) => run(() => addLink.mutateAsync({ id: launchId, step, body: { title: title.trim() || undefined, url } }))}
      onRemoveLink={(linkId) => void run(() => removeLink.mutateAsync({ id: launchId, linkId }))}
      onSetUp={(body) => run(() => setUp.mutateAsync({ id: launchId, body }))}
    />
  )
}
