import { Button } from '@carbon/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { GAP, MARGIN, placeCard, scrollDelta, type Box } from './placement'
import type { Tour, TourStep } from './tours'
import styles from './TourOverlay.module.scss'

const PAD = 6 // the spotlight stands this far off the thing it points at
const WAIT_MS = 6000 // how long to wait for a page and its data before the card simply sits in the middle
const rem = (px: number) => `${px / 16}rem`

const onRoute = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

// The first element a selector finds that is actually showing.
function findTarget(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { x: r.left - PAD, y: r.top - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD }
}

// The card's size at its usual width. A docked card is wider (so shorter): measuring it that way would make a card that no longer fits
// beside its target look as if it did.
function measureCard(box: HTMLElement) {
  box.dataset.mode = 'beside'
  return { width: box.offsetWidth, height: box.offsetHeight }
}

type Props = { tour: Tour; steps: TourStep[]; index: number; onBack: () => void; onNext: () => void; onEnd: () => void }

// One step of a tour: a dimmed page with a lit window around the thing being explained, and a card beside it. The card goes where it
// covers nothing the step points at (see placement.ts); on a narrow screen it docks along the bottom. The page behind cannot be clicked
// while a tour runs; Escape, Skip tour or finishing gives it back.
export function TourOverlay({ tour, steps, index, onBack, onNext, onEnd }: Props) {
  const step = steps[index]
  const last = index === steps.length - 1
  const navigate = useNavigate()
  // The page the router has drawn. The address bar changes first, while the old page is still on screen, so it is not used to decide a page is ready.
  const { pathname } = useLocation()
  const here = useRef(pathname)
  useEffect(() => {
    here.current = pathname
  }, [pathname])
  const root = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const target = useRef<Element | null>(null)
  const started = useRef(0)
  const [status, setStatus] = useState<'finding' | 'target' | 'center'>('finding')

  // Draws the spotlight and the card for where the target is now.
  const draw = useCallback(() => {
    let el = target.current
    const node = root.current
    const box = card.current
    if (!node || !box) return
    const view = { width: window.innerWidth, height: window.innerHeight }
    // The page redrew and replaced what was lit (data arriving, say): look it up again rather than leave the light where it was.
    if ((!el || !el.isConnected) && step.target) target.current = findTarget(step.target)
    el = target.current
    if (!el || !el.isConnected) {
      node.dataset.spot = 'false'
      box.dataset.mode = 'center'
      return
    }
    const t = boxOf(el)
    const size = measureCard(box)
    const p = placeCard(t, size, view)
    node.dataset.spot = 'true'
    node.style.setProperty('--tour-x', rem(t.x))
    node.style.setProperty('--tour-y', rem(t.y))
    node.style.setProperty('--tour-w', rem(t.width))
    node.style.setProperty('--tour-h', rem(t.height))
    box.dataset.mode = p.mode
    // A target too tall to show above a docked card is lit only as far as the card, so nothing lit is ever covered.
    if (p.mode === 'dock') {
      const bottom = view.height - MARGIN - size.height - GAP
      if (t.y + t.height > bottom) node.style.setProperty('--tour-h', rem(Math.max(bottom - t.y, 48)))
    }
    if (p.mode === 'beside') {
      node.style.setProperty('--tour-card-x', rem(p.x))
      node.style.setProperty('--tour-card-y', rem(p.y))
    }
  }, [step.target])

  // A new step: go to its page.
  useEffect(() => {
    started.current = Date.now()
    if (!onRoute(here.current, step.route)) navigate(step.route)
  }, [step.route, navigate])

  // Wait for the page, and the data on it, to show the target.
  useEffect(() => {
    if (status !== 'finding') return
    const timer = window.setInterval(() => {
      const there = onRoute(here.current, step.route)
      if (there && !step.target) return setStatus('center')
      const el = there && step.target ? findTarget(step.target) : null
      if (el) {
        target.current = el
        setStatus('target')
      } else if (Date.now() - started.current > WAIT_MS) {
        setStatus('center')
      }
    }, 150)
    return () => window.clearInterval(timer)
  }, [status, step])

  // Brings the target into view (and, if the card will have to dock, up out of the way of it), then draws.
  const fit = useCallback(() => {
    if (!target.current?.isConnected && step.target) target.current = findTarget(step.target)
    const el = target.current
    if (el) {
      const view = { width: window.innerWidth, height: window.innerHeight }
      const first = scrollDelta(boxOf(el), view, false)
      if (first) window.scrollBy({ top: first, behavior: 'auto' })
      const size = card.current ? measureCard(card.current) : { width: 0, height: 0 }
      if (placeCard(boxOf(el), size, view).mode === 'dock') {
        const second = scrollDelta(boxOf(el), view, true)
        if (second) window.scrollBy({ top: second, behavior: 'auto' })
      }
    }
    draw()
  }, [draw, step.target])

  // Found: fit it, and move focus to the card.
  useEffect(() => {
    if (status === 'finding') return
    fit()
    next.current?.focus({ preventScroll: true })
  }, [status, fit])

  // Then keep it right. Pages move under a tour: data arrives and the layout settles, things slide in, someone scrolls or resizes. None of
  // that is announced for a thing that only moves, so every frame the target's place is compared with where it was drawn. If it moved
  // because the page shifted (not because the person scrolled), it is fitted again; if they scrolled, the light just follows.
  useEffect(() => {
    if (status !== 'target') return
    let frame = 0
    let last = ''
    let lastScroll = window.scrollY
    const keyOf = (el: Element | null) => {
      if (!el) return 'none'
      const r = el.getBoundingClientRect()
      return `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)},${window.innerWidth},${window.innerHeight}`
    }
    const tick = () => {
      const el = target.current?.isConnected ? target.current : step.target ? findTarget(step.target) : null
      if (el && el !== target.current) target.current = el
      if (keyOf(el) !== last) {
        if (window.scrollY === lastScroll) fit()
        else draw()
        last = keyOf(target.current) // after fit(), which may have scrolled
      }
      lastScroll = window.scrollY
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [status, step.target, fit, draw])

  // Keys: Escape ends the tour, the arrows move through it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onEnd()
      else if (event.key === 'ArrowRight' && !last) onNext()
      else if (event.key === 'ArrowLeft' && index > 0) onBack()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, last, onBack, onEnd, onNext])

  return (
    <div className={styles.root} ref={root} data-spot="false" data-testid="tour" data-target={step.target}>
      <div className={styles.dim} />
      <div className={styles.spot} />
      <div className={styles.card} ref={card} data-mode="center" data-state={status} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body">
        <p className={styles.eyebrow}>
          {tour.title} · Step {index + 1} of {steps.length}
        </p>
        <h2 className={styles.title} id="tour-title">
          {step.title}
        </h2>
        <p className={styles.body} id="tour-body">
          {step.body}
        </p>
        <div className={styles.actions}>
          {!last && (
            <Button kind="ghost" size="md" onClick={onEnd} data-testid="tour-skip">
              Skip tour
            </Button>
          )}
          <span className={styles.spacer} />
          {index > 0 && (
            <Button kind="secondary" size="md" onClick={onBack} data-testid="tour-back">
              Back
            </Button>
          )}
          <Button kind="primary" size="md" ref={next} onClick={last ? onEnd : onNext} data-testid="tour-next">
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
