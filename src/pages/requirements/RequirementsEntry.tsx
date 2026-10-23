import { Button, InlineNotification, Loading } from '@carbon/react'
import type { ProjectDetail } from '../../api/client'
import { ProjectHeader } from '../project/ProjectHeader'
import styles from './RequirementsEntry.module.scss'

export type RequirementsEntryProps = {
  state: 'loading' | 'drafting' | 'error' | 'not_analyzed' | 'not_started'
  project?: ProjectDetail
  errorText?: string
  onRetry: () => void
  onGoToTranscripts: () => void
}

// Presentational: what the Requirements step shows before the project's document is open. A project has one document, so
// there is no list: it is drafted the first time an editor opens this step, and this page is what they see meanwhile.
export function RequirementsEntry({ state, project, errorText, onRetry, onGoToTranscripts }: RequirementsEntryProps) {
  return (
    <div className={styles.page}>
      {project && <ProjectHeader title="Requirements" description="Turn the themes into a reviewed product brief and requirements, then publish them to the board." />}
      {(state === 'loading' || state === 'drafting') && <Loading small withOverlay={false} description={state === 'drafting' ? 'Drafting the first step from the themes' : 'Loading'} />}
      {state === 'drafting' && <p>Drafting the first step from the themes. This takes a few seconds.</p>}
      {state === 'error' && (
        <>
          <InlineNotification kind="warning" lowContrast hideCloseButton title="Not started" subtitle={errorText} />
          <div className={styles.actions}>
            <Button kind="primary" size="md" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </>
      )}
      {state === 'not_analyzed' && (
        <>
          <InlineNotification kind="info" lowContrast hideCloseButton title="Analyze first" subtitle="The requirements document is drafted from the themes, so the transcripts need to be analyzed first." />
          <div className={styles.actions}>
            <Button kind="primary" size="md" onClick={onGoToTranscripts}>
              Go to Transcripts
            </Button>
          </div>
        </>
      )}
      {state === 'not_started' && <InlineNotification kind="info" lowContrast hideCloseButton title="Not started" subtitle="Requirements have not been started for this project. Someone with editing access starts them by opening this step." />}
    </div>
  )
}
