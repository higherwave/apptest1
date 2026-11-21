import { ChevronDown, ChevronUp, Locked } from '@carbon/icons-react'
import { Button } from '@carbon/react'
import { useEffect, useRef, useState } from 'react'
import type { StepState } from './nav'
import styles from './SectionNav.module.scss'

export type NavItem = {
  key: string
  label: string
  to: string
  active: boolean
  /** A step that is not open yet: dimmed, with a lock, and not a link that goes anywhere. */
  locked?: boolean
  /** Why a locked item is not open yet. */
  hint?: string
  /** How a project step reads while the project is being set up (current, ready, locked, done). */
  state?: StepState
  testId?: string
}
export type NavGroup = { label: string; items: NavItem[] }

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ')

// True on a phone-width window (under 640px), where the groups fold into one menu button.
const PHONE = '(max-width: 39.9375rem)'
export function usePhone() {
  const [phone, setPhone] = useState(() => (typeof window === 'undefined' || !window.matchMedia ? false : window.matchMedia(PHONE).matches))
  useEffect(() => {
    if (!window.matchMedia) return
    const query = window.matchMedia(PHONE)
    const onChange = () => setPhone(query.matches)
    onChange()
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return phone
}

// The menu inside a project and inside Admin: groups of items laid out in a row under the title bar, each group with its name above it (the names drop away on a tablet to save room).
// On a phone the row becomes one button naming where you are ("Analysis › Storyboard") that opens the groups as a list. The same items, links with data-label so tests and scripts find
// them by name, are shown either way.
// `dataNav` marks a project's steps with data-nav, as its old rail was, so scripts that find the project's menu that way still do (Admin's row is not marked: the header's items are what data-nav means elsewhere).
export function SectionNav({ label, groups, onGo, dataNav = false }: { label: string; groups: NavGroup[]; onGo: (to: string) => void; dataNav?: boolean }) {
  const phone = usePhone()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLElement>(null)
  const current = groups.flatMap((g) => g.items.map((i) => ({ group: g.label, item: i }))).find((x) => x.item.active)

  // The list closes on a click anywhere else, on Escape, and when the window grows out of phone width.
  useEffect(() => {
    if (!open) return
    const outside = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    const escape = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])
  useEffect(() => {
    if (!phone) setOpen(false)
  }, [phone])

  const link = (item: NavItem, kind: 'tab' | 'menu') => (
    <a
      key={item.key}
      href={item.to}
      data-label={item.label}
      data-state={item.state}
      data-testid={item.testId}
      role={kind === 'menu' ? 'menuitem' : undefined}
      aria-current={item.active ? 'page' : undefined}
      aria-disabled={item.locked || undefined}
      title={item.locked ? item.hint : undefined}
      className={cx(kind === 'tab' ? styles.tab : styles.item, item.active && styles.active, item.locked && styles.locked)}
      onClick={(e) => {
        e.preventDefault()
        if (item.locked) return
        setOpen(false)
        onGo(item.to)
      }}
    >
      {item.label}
      {item.locked && <Locked size={16} className={styles.lock} aria-hidden />}
    </a>
  )

  if (phone) {
    return (
      <nav ref={box} className={styles.phone} aria-label={label} data-nav={dataNav || undefined}>
        <Button kind="ghost" size="lg" className={styles.trigger} aria-haspopup="true" aria-expanded={open} data-testid="section-menu" renderIcon={open ? ChevronUp : ChevronDown} onClick={() => setOpen((o) => !o)}>
          <span className={styles.where}>
            {current && <span className={styles.whereGroup}>{current.group}</span>}
            {current && <span className={styles.sep} aria-hidden>›</span>}
            <span className={styles.whereItem}>{current?.item.label ?? 'Menu'}</span>
          </span>
        </Button>
        {open && (
          <div className={styles.menu} role="menu">
            {groups.map((g) => (
              <div key={g.label} className={styles.menuGroup} role="group" aria-label={g.label}>
                <p className={styles.caption}>{g.label}</p>
                {g.items.map((i) => link(i, 'menu'))}
              </div>
            ))}
          </div>
        )}
      </nav>
    )
  }

  return (
    <nav className={styles.row} aria-label={label} data-nav={dataNav || undefined}>
      {groups.map((g) => (
        <div key={g.label} className={styles.group} role="group" aria-label={g.label}>
          <p className={styles.caption}>{g.label}</p>
          <div className={styles.tabs}>{g.items.map((i) => link(i, 'tab'))}</div>
        </div>
      ))}
    </nav>
  )
}
