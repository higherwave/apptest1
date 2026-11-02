import { Close } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useEffect, useRef, useState } from 'react'
import { useAiStatus, useMe } from '../api/hooks'
import styles from './SpendBanner.module.scss'

// Owners only: a bar above the app header once the month's AI spend reaches 50%, 80% and 100% of the budget. Dismissing it hides
// that level for this month in this browser; the next level up (or the next month) brings it back.
const KEY = 'sf-spend-banner-dismissed'
const read = () => {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}
const write = (v: string) => {
  try {
    localStorage.setItem(KEY, v)
  } catch {
    // Private windows can refuse storage; the banner then simply comes back on the next visit.
  }
}

const money = (n: number) => `$${n.toFixed(2)}`
const HEADLINE = { half: 'Half of the monthly AI budget is used', high: 'Most of the monthly AI budget is used', reached: 'The monthly AI budget is used up' } as const

/** Reports its height (in rem) so the fixed app bar below can sit underneath it; 0 when it is not showing. */
export function SpendBanner({ onHeight }: { onHeight: (rem: number) => void }) {
  const me = useMe()
  const ai = useAiStatus()
  const ref = useRef<HTMLDivElement>(null)
  const [dismissed, setDismissed] = useState<string | null>(read)

  const s = ai.data
  const level = s?.spendLevel
  const key = s?.month && level ? `${s.month}:${level}` : null
  const show = me.data?.role === 'owner' && s?.mode === 'live' && !!level && level !== 'ok' && !!key && dismissed !== key

  useEffect(() => {
    const el = ref.current
    if (!show || !el) {
      onHeight(0)
      return
    }
    const measure = () => onHeight(el.getBoundingClientRect().height / 16)
    measure()
    const watcher = new ResizeObserver(measure)
    watcher.observe(el)
    return () => {
      watcher.disconnect()
      onHeight(0)
    }
  }, [show, onHeight])

  if (!show || !s || !level || !key) return null
  const pct = s.budgetUsd ? Math.round(((s.spentUsd ?? 0) / s.budgetUsd) * 100) : 100
  return (
    <div ref={ref} className={styles.banner} data-level={level} role={level === 'half' ? 'status' : 'alert'} data-testid="spend-banner">
      <p className={styles.text}>
        <strong>{HEADLINE[level]}.</strong> {money(s.spentUsd ?? 0)} of {money(s.budgetUsd ?? 0)} spent so far this month ({pct}%).{' '}
        {level === 'reached' ? 'AI steps now use the simulation until next month or a higher budget (AI_MONTHLY_BUDGET_USD).' : 'At 100% AI steps switch to the simulation.'}
      </p>
      <Button
        kind="ghost"
        size="sm"
        hasIconOnly
        renderIcon={Close}
        iconDescription="Dismiss spend alert"
        tooltipPosition="left"
        data-testid="spend-banner-dismiss"
        onClick={() => {
          write(key)
          setDismissed(key)
        }}
      />
    </div>
  )
}
