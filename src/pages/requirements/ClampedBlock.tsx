import { Button } from '@carbon/react'
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from './ClampedBlock.module.scss'

// A few lines of a longer section, with "Show more" to read the rest. The button only appears when the text really is cut off,
// and it is measured again as the text or the width changes.
export function ClampedBlock({ children, label }: { children: ReactNode; label: string }) {
  const body = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)

  useLayoutEffect(() => {
    const el = body.current
    if (!el || open) return
    const measure = () => setCut(el.scrollHeight > el.clientHeight + 1)
    measure()
    const watch = new ResizeObserver(measure)
    watch.observe(el)
    return () => watch.disconnect()
  }, [open, children])

  return (
    <div>
      <div ref={body} className={open ? styles.body : `${styles.body} ${styles.clamped}`}>
        {children}
      </div>
      {(cut || open) && (
        <Button className={styles.toggle} kind="ghost" size="sm" aria-expanded={open} aria-label={`${open ? 'Show less of' : 'Show more of'} ${label}`} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}
    </div>
  )
}
