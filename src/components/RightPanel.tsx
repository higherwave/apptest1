import { Modal } from '@carbon/react'
import type { ReactNode } from 'react'
import styles from './RightPanel.module.scss'

// The right panel: slides in from the right edge and leaves the page visible behind it, so people stay oriented in what they were doing.
// A passive Carbon Modal laid out at the edge, so the scrim, focus trap, Escape and the return of focus are Carbon's. One at a time; a choice
// made in it applies at once and closes it. Never position a drawer by hand: the design-system linter refuses it (pattern signal-flow-right-panel).
export function RightPanel({ open, heading, label, focus, wide = false, onClose, children }: { open: boolean; /** A wider panel, for content that holds a table or a form (the workspace setup). */ wide?: boolean; heading: string; label?: string; /** A selector for what takes focus when it opens (a search box, say); without one, focus starts on the panel itself. */ focus?: string; onClose: () => void; children: ReactNode }) {
  return (
    <Modal className={wide ? `${styles.panel} ${styles.wide}` : styles.panel} open={open} passiveModal size="sm" modalLabel={label} modalHeading={heading} selectorPrimaryFocus={focus ?? '[data-panel-start]'} onRequestClose={onClose}>
      {/* Focus starts here, not on the close button, so opening a panel does not light the close button up. */}
      <div data-panel-start tabIndex={-1} className={styles.start}>{children}</div>
    </Modal>
  )
}
