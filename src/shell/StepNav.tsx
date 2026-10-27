import { Locked } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useEffect, useState } from 'react'
import { STEP_GROUPS, type StepGroup } from './nav'
import styles from './StepNav.module.scss'

export type StepItem = {
  key: string
  label: string
  group: StepGroup
  number: number
  to: string
  active: boolean
  locked: boolean
  /** Why a locked step is not open yet. */
  hint?: string
}

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// True while the window is at least this wide. Below it, one group of steps is shown at a time.
const WIDE = '(min-width: 65rem)'
function useWide() {
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

// The project's steps as a horizontal strip under the app bar. Wide windows show every group in one line; narrow ones show a row
// of group buttons and only the steps of the group being viewed, which starts as the group of the open step.
export function StepNav({ items, onGo }: { items: StepItem[]; onGo: (to: string) => void }) {
  const wide = useWide()
  const activeGroup = items.find((i) => i.active)?.group ?? STEP_GROUPS[0]
  // A group picked by hand holds only while the open step stays in the same group.
  const [picked, setPicked] = useState<{ from: StepGroup; group: StepGroup } | null>(null)
  const viewing = picked && picked.from === activeGroup ? picked.group : activeGroup

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
      <span className={styles.number} aria-hidden>
        {item.number}
      </span>
      <span className={styles.tabLabel}>
        {item.label}
        {item.locked && <Locked size={16} className={styles.lock} aria-hidden />}
      </span>
    </a>
  )

  return (
    <nav className={styles.strip} aria-label="Project steps" data-nav>
      {wide ? (
        <div className={styles.groups}>
          {STEP_GROUPS.map((group) => (
            <div key={group} className={styles.group}>
              <p className={cx(styles.groupLabel, group === activeGroup && styles.groupLabelActive)}>{group}</p>
              <div className={styles.tabs}>{items.filter((i) => i.group === group).map(tab)}</div>
            </div>
          ))}
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
