import { Button } from '@carbon/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from './ClampedBlock.module.scss'

// A section of the document, open in full by default. When it is longer than a few lines, "Show less" folds it to four lines and
// "Show more" opens it again; a short section has no button. It is measured again as the text or the width changes.
export function ClampedBlock({ children, label }: { children: ReactNode; label: string }) {
  const body = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(true)
  const [long, setLong] = useState(false)

  useLayoutEffect(() => {
    const el = body.current
    if (!el) return
    // Four lines, plus the gaps between paragraphs: the same height the folded state is cut to.
    const measure = () => {
      const cs = getComputedStyle(el)
      const limit = parseFloat(cs.fontSize) * 1.55 * 4 + (parseFloat(cs.rowGap) || 0) * 2
      setLong(el.scrollHeight > limit + 1)
    }
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [children])

  return (
    <div>
      <div ref={body} className={open ? styles.body : `${styles.body} ${styles.clamped}`}>
        {children}
      </div>
      {long && (
        <Button className={styles.toggle} kind="ghost" size="sm" aria-expanded={open} aria-label={`${open ? 'Show less of' : 'Show more of'} ${label}`} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  )
}
