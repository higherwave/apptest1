import { Button } from '@carbon/react'
import { Locked } from '@carbon/icons-react'
import { useEffect, useState } from 'react'
import { STEP_GROUPS, STEP_NOTES, type StepGroup, type StepState } from './nav'
import styles from './StepNav.module.scss'

export type StepItem = {
  key: string
  label: string
  group: StepGroup
  number: number
  to: string
  active: boolean
  locked: boolean
  /** How the step reads in the rail: set-up progress while the project is being built, neutral after. */
  state: StepState
  /** Why a locked step is not open yet. */
  hint?: string
}

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// True while the window is wide enough for the steps to stand as a rail beside the page (1024px, the tablet in landscape and up).
// Below it, one group of steps is shown at a time in a strip under the project bar.
const WIDE = '(min-width: 64rem)'
export function useRailWide() {
  const [wide, setWide] = useState(() => (typeof window === 'undefined' || !window.matchMedia ? true : window.matchMedia(WIDE).matches))
  useEffect(() => {
    if (!window.matchMedia) return
    const query = window.matchMedia(WIDE)
    const onChange = () => setWide(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return wide
}

// The project's steps. Wide windows show a vertical rail beside the page, the four groups stacked with their steps (the name and one
// line on what it is); narrow ones show a row of group buttons and only the steps of the group being viewed, which starts as the group of the open step.
export function StepNav({ items, onGo }: { items: StepItem[]; onGo: (to: string) => void }) {
  const wide = useRailWide()
  const activeGroup = items.find((i) => i.active)?.group ?? STEP_GROUPS[0]
  // A group picked by hand holds only while the open step stays in the same group.
  const [picked, setPicked] = useState<{ from: StepGroup; group: StepGroup } | null>(null)
  const viewing = picked && picked.from === activeGroup ? picked.group : activeGroup

  // The narrow strip's tab: the name, with a lock on a step that is not open yet.
  const tab = (item: StepItem) => (
    <a
      key={item.key}
      href={item.to}
      data-label={item.label}
      aria-current={item.active ? 'page' : undefined}
      aria-disabled={item.locked || undefined}
      title={item.locked ? item.hint : undefined}
      className={cx(styles.tab, item.active && styles.tabActive, item.locked && styles.tabLocked)}
      onClick={(e) => {
        e.preventDefault()
        if (!item.locked) onGo(item.to)
      }}
    >
      <span className={styles.tabLabel}>
        {item.label}
        {item.locked && <Locked size={16} className={styles.lock} aria-hidden />}
      </span>
    </a>
  )

  // The rail's row: the step's name and one line about it, left-aligned with the group label above. Where the project is in its set-up shows
  // in the row itself (data-state), not in a number.
  const row = (item: StepItem) => (
    <a
      key={item.key}
      href={item.to}
      data-label={item.label}
      data-state={item.state}
      aria-current={item.active ? 'page' : undefined}
      aria-disabled={item.locked || undefined}
      title={item.locked ? item.hint : undefined}
      className={cx(styles.row, item.active && styles.rowActive)}
      onClick={(e) => {
        e.preventDefault()
        if (!item.locked) onGo(item.to)
      }}
    >
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{item.label}</span>
        <span className={styles.rowNote}>{STEP_NOTES[item.key]}</span>
      </span>
    </a>
  )

  return (
    <nav className={cx(styles.strip, wide && styles.rail)} aria-label="Project steps" data-nav>
      {wide ? (
        <div className={styles.railInner}>
          {STEP_GROUPS.map((group) => {
            const its = items.filter((i) => i.group === group)
            return (
              <div key={group} className={styles.railGroup}>
                <p className={cx(styles.railLabel, its.every((i) => i.locked) && styles.railLabelLocked)}>{group}</p>
                {its.map(row)}
              </div>
            )
          })}
        </div>
      ) : (
        <>
          <div className={styles.chips} role="group" aria-label="Step groups">
            {STEP_GROUPS.map((group) => (
              <Button key={group} kind={group === viewing ? 'primary' : 'tertiary'} size="sm" aria-pressed={group === viewing} onClick={() => setPicked({ from: activeGroup, group })}>
                {group}
              </Button>
            ))}
          </div>
          <div className={styles.tabs}>{items.filter((i) => i.group === viewing).map(tab)}</div>
        </>
      )}
    </nav>
  )
}
