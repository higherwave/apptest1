import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { usePeek } from './context'
import { isPlainClick, peekHref, type PeekTarget } from './targets'

// A real link to the target's full page (so it can still be opened in a new tab) that, on an ordinary click, opens the quick-reference drawer instead.
export function PeekLink({ target, className, children, ...rest }: { target: PeekTarget; className?: string; children: ReactNode; 'data-testid'?: string }) {
  const peek = usePeek()
  return (
    <Link
      to={peekHref(target)}
      className={className}
      onClick={(e) => {
        if (!isPlainClick(e)) return
        e.preventDefault()
        peek.open(target)
      }}
      {...rest}
    >
      {children}
    </Link>
  )
}
