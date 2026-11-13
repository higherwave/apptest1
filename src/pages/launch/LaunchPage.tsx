import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { friendlyMessage } from '../../api/client'
import { useCreateLaunch, useProject, useProjectLaunch } from '../../api/hooks'
import { LaunchScreen } from './LaunchScreen'
import { LaunchStartView } from './LaunchStartView'

// A project's Launch step: its launch if it has one, else the chance to start one.
export function LaunchPage() {
  const { projectId = '' } = useParams()
  const found = useProjectLaunch(projectId)
  const project = useProject(projectId)
  const create = useCreateLaunch(projectId)
  const [error, setError] = useState<string | undefined>()
  if (found.data?.launch) return <LaunchScreen launchId={found.data.launch.id} />
  return (
    <LaunchStartView
      state={found.isPending ? 'loading' : 'ready'}
      canCreate={!!found.data?.canCreate}
      whyNot={found.data?.whyNot ?? null}
      busy={create.isPending}
      errorText={found.isError ? friendlyMessage(found.error) : error}
      projectName={project.data?.name}
      onStart={async (name, targetDate) => {
        setError(undefined)
        try {
          await create.mutateAsync({ name: name || undefined, targetDate })
          return true
        } catch (err) {
          setError(friendlyMessage(err))
          return false
        }
      }}
    />
  )
}
