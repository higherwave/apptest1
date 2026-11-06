import { Button, OverflowMenu, OverflowMenuItem, Popover, PopoverContent, Tag } from '@carbon/react'
import { useEffect, useRef, useState } from 'react'
import type { Theme, ThemePatch } from '../../api/client'
import { CategoryBadge } from './CategoryBadge'
import { EFFORT_LABEL, LEVEL_LABEL, MOVES, MOVE_LABEL, movePatch, participantsLabel, type Level } from './themeEdits'
import styles from './PrioritiesView.module.scss'

/** How long a pointer or keyboard focus rests on a node before its details open. */
export const DETAILS_DELAY_MS = 2000

export type PriorityNodeProps = {
  theme: Theme
  canEdit: boolean
  busy: boolean
  onEdit: (theme: Theme, patch: ThemePatch) => void
}

// One theme on the matrix: a draggable chip, and for editors a three-dot menu that does what dragging does (move up, down, right, left, or back to the
// suggestion), for people who cannot drag. Its details (category, who raised it, the suggestion, the effort note) are not on the page: they open in a panel
// beside the node once the pointer or focus has rested on it for two seconds, or at once on a click or tap. Escape, leaving, or a second click closes it.
export function PriorityNode({ theme: t, canEdit, busy, onEdit }: PriorityNodeProps) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const menuOpen = useRef(false)
  const clear = () => window.clearTimeout(timer.current)
  const arm = () => {
    clear()
    timer.current = window.setTimeout(() => !menuOpen.current && setOpen(true), DETAILS_DELAY_MS)
  }
  const close = () => {
    clear()
    setOpen(false)
    setPinned(false)
  }
  useEffect(() => clear, [])

  return (
    <Popover
      open={open}
      align="bottom-start"
      autoAlign
      dropShadow
      className={styles.node}
      onRequestClose={close}
      onMouseEnter={arm}
      onMouseLeave={() => !pinned && close()}
      onFocus={arm}
      onBlur={() => !pinned && close()}
      onKeyDown={(e: React.KeyboardEvent) => e.key === 'Escape' && close()}
    >
      <div className={styles.nodeRow}>
        <Button
          kind="tertiary"
          size="sm"
          className={styles.chip}
          data-edited={t.edited}
          aria-describedby={open ? `details-${t.id}` : undefined}
          draggable={canEdit && !busy}
          onDragStart={(e: React.DragEvent) => {
            close()
            e.dataTransfer.setData('text/plain', t.id)
          }}
          onClick={() => {
            if (open && pinned) return close()
            clear()
            setOpen(true)
            setPinned(true)
          }}
        >
          {t.title}
        </Button>
        {canEdit && (
          <OverflowMenu
            iconDescription={`Actions for ${t.title}`}
            size="sm"
            flipped
            onOpen={() => {
              menuOpen.current = true
              close()
            }}
            onClose={() => {
              menuOpen.current = false
            }}
          >
            {MOVES.map((m) => {
              const patch = movePatch(t, m)
              return <OverflowMenuItem key={m} itemText={MOVE_LABEL[m]} disabled={busy || !patch} onClick={() => patch && onEdit(t, patch)} />
            })}
            <OverflowMenuItem itemText="Reset to suggestion" disabled={busy || !t.edited} onClick={() => onEdit(t, { priority: null, effort: null })} />
          </OverflowMenu>
        )}
      </div>
      {/* Not rendered until it is open: a closed panel would sit, unseen, over the node below and take its pointer. */}
      {open && (
        <PopoverContent className={styles.details} id={`details-${t.id}`}>
          <div className={styles.detailsHead}>
            <CategoryBadge category={t.category} />
            {t.edited && (
              <Tag size="sm" type="warm-gray">
                Edited
              </Tag>
            )}
          </div>
          <p className={styles.detailsTitle}>{t.title}</p>
          <p className={styles.facts}>{participantsLabel(t)}</p>
          <p className={styles.facts}>
            Suggested: {LEVEL_LABEL[t.suggestedPriority as Level]} importance, {EFFORT_LABEL[t.suggestedEffort]} effort.
          </p>
          {t.effortNote && <p className={styles.note}>{t.effortNote}</p>}
        </PopoverContent>
      )}
    </Popover>
  )
}
