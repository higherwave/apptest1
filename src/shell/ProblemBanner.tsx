import { Close } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { dismissProblems, getProblems, levelOf, problemsText, subscribeProblems } from './problems'
import styles from './ProblemBanner.module.scss'

// A slim bar fixed above the app header whenever the browser met a problem (see problems.ts). Red for a script error, yellow for a failed
// request. It sits above everything and the header moves down by its height (--at-error-banner), so nothing is covered. Lives in its own
// React root so it still shows when the app itself fails.
export function ProblemBanner() {
  const list = useSyncExternalStore(subscribeProblems, getProblems)
  const ref = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)
  const show = list.length > 0

  useEffect(() => {
    const root = document.documentElement
    const el = ref.current
    if (!show || !el) {
      root.style.setProperty('--at-error-banner', '0rem')
      return
    }
    const measure = () => root.style.setProperty('--at-error-banner', `${el.getBoundingClientRect().height / 16}rem`)
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => {
      watcher.disconnect()
      root.style.setProperty('--at-error-banner', '0rem')
    }
  }, [show])

  if (!show) return null
  const latest = list[list.length - 1]
  const level = levelOf(list)
  const total = list.reduce((n, p) => n + p.count, 0)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(problemsText(list, window.location.pathname + window.location.search))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard access: the details stay in the console for whoever needs them.
      console.warn(problemsText(list, window.location.pathname))
    }
  }
  return (
    <div ref={ref} className={styles.banner} data-level={level} role="alert" data-testid="problem-banner">
      <p className={styles.text}>
        <strong>{level === 'script' ? 'Something went wrong.' : 'A request did not go through.'}</strong> {latest.message}
        {total > 1 ? ` (${total} in all)` : ''}
      </p>
      <span className={styles.actions}>
        <Button kind="ghost" size="sm" className={styles.copy} onClick={copy} data-testid="problem-copy">
          {copied ? 'Copied' : 'Copy details'}
        </Button>
        <Button kind="ghost" size="sm" hasIconOnly renderIcon={Close} iconDescription="Dismiss" tooltipPosition="left" onClick={dismissProblems} data-testid="problem-dismiss" />
      </span>
    </div>
  )
}
