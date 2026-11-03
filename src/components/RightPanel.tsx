import { Modal } from '@carbon/react'
import type { ReactNode } from 'react'
import styles from './RightPanel.module.scss'

// The right panel: slides in from the right edge and leaves the page visible behind it, so people stay oriented in what they were doing.
// A passive Carbon Modal laid out at the edge, so the scrim, focus trap, Escape and the return of focus are Carbon's. One at a time; a choice
// made in it applies at once and closes it. Never position a drawer by hand: the design-system linter refuses it (pattern signal-flow-right-panel).
export function RightPanel({ open, heading, label, onClose, children }: { open: boolean; heading: string; label?: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal className={styles.panel} open={open} passiveModal size="sm" modalLabel={label} modalHeading={heading} onRequestClose={onClose}>
      {children}
    </Modal>
  )
}
