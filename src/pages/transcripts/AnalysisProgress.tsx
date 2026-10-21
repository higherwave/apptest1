import { CheckmarkFilled, CircleDash } from '@carbon/icons-react'
import { Modal } from '@carbon/react'
import styles from './AnalysisProgress.module.scss'

type AnalysisProgressProps = { open: boolean; steps: string[]; current: number }

// The progress list shown while the analysis runs. A step is done when it is before the current one.
export function AnalysisProgress({ open, steps, current }: AnalysisProgressProps) {
  return (
    <Modal open={open} passiveModal size="sm" modalHeading="Analyzing transcripts" onRequestClose={() => undefined}>
      <ol className={styles.steps}>
        {steps.map((title, i) => (
          <li key={title} className={styles.step} data-state={i < current ? 'done' : i === current ? 'active' : 'waiting'}>
            {i < current ? <CheckmarkFilled aria-label="Done" /> : <CircleDash aria-label={i === current ? 'In progress' : 'Waiting'} />}
            <span>{title}</span>
          </li>
        ))}
      </ol>
    </Modal>
  )
}
