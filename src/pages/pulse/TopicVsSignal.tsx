import { Button, Popover, PopoverContent } from '@carbon/react'
import { useState } from 'react'
import styles from './TopicVsSignal.module.scss'

// "What's the difference in a topic and a signal?": link-style text that explains on hover or keyboard focus (and on a tap, for a tablet).
export function TopicVsSignal() {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} align="bottom" dropShadow className={styles.wrap} onRequestClose={() => setOpen(false)}>
      <span onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
        <Button kind="ghost" size="sm" className={styles.link} aria-expanded={open} data-testid="topic-vs-signal" onClick={() => setOpen((o) => !o)}>
          What’s the difference in a topic and a signal?
        </Button>
      </span>
      <PopoverContent className={styles.tip} data-testid="topic-vs-signal-tip">
        <p className={styles.tipText}>
          <strong>A signal</strong> is one thing a customer, prospect or colleague said or wrote: a quote, a request, a complaint, a support ticket or a note on a deal.
        </p>
        <p className={styles.tipText}>
          <strong>A topic</strong> is a pattern: two or more signals about the same problem or need, grouped together and ranked. One signal on its own could be a one-off, so it waits until a second one backs it up.
        </p>
      </PopoverContent>
    </Popover>
  )
}
