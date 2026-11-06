import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

export type StripView = { first: number; last: number; canBack: boolean; canForward: boolean }

// A row that scrolls sideways, a card at a time (the Recommendations strip and the Storyboard's slide strip): which of its children are fully
// showing, measured from the scroll position, and Previous/Next that move it by most of its width. `watch` is whatever changes the children.
export function useStrip(count: number, watch: unknown): { track: RefObject<HTMLUListElement | null>; view: StripView; measure: () => void; move: (direction: 1 | -1) => void } {
  const track = useRef<HTMLUListElement>(null)
  const [view, setView] = useState<StripView>({ first: 1, last: count, canBack: false, canForward: false })

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    const cards = [...el.children] as HTMLElement[]
    const left = el.scrollLeft
    const right = left + el.clientWidth
    // A card's place along the track, measured from the track itself (offsetLeft is from the nearest positioned ancestor, which is not the track).
    const origin = el.getBoundingClientRect().left
    const showing = cards
      .map((c, i) => {
        const box = c.getBoundingClientRect()
        const start = box.left - origin + left
        return { i, whole: start >= left - 1 && start + box.width <= right + 1 }
      })
      .filter((c) => c.whole)
    setView({
      first: showing.length ? showing[0].i + 1 : 1,
      last: showing.length ? showing[showing.length - 1].i + 1 : cards.length,
      canBack: left > 1,
      canForward: left + el.clientWidth < el.scrollWidth - 1,
    })
  }, [])

  useEffect(() => {
    const el = track.current
    if (!el) return
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, watch])

  const move = (direction: 1 | -1) => {
    const el = track.current
    if (!el) return
    const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: calm ? 'auto' : 'smooth' })
  }

  return { track, view, measure, move }
}
