// Where a tour card goes. Pure geometry (all numbers are CSS pixels), so it can be tested without a browser.
// The card sits beside the thing it explains, never over it: below, above, to the right, then to the left; when none of those fits
// (a big target, or a narrow tablet) it docks along the bottom edge and the page is scrolled so the target's top stays in view above it.

export type Box = { x: number; y: number; width: number; height: number }
export type Placement = { mode: 'beside'; x: number; y: number; side: 'below' | 'above' | 'right' | 'left' } | { mode: 'dock' } | { mode: 'center' }

export const GAP = 16 // between the target and the card
export const MARGIN = 16 // between the card and the screen edge
export const TOP_CLEARANCE = 128 // the app bars at the top of the screen: a target is scrolled to sit below this

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(n, hi))
const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

export function placeCard(target: Box | null, card: { width: number; height: number }, view: { width: number; height: number }): Placement {
  if (!target) return { mode: 'center' }
  const minY = TOP_CLEARANCE
  const maxX = view.width - card.width - MARGIN
  const maxY = view.height - card.height - MARGIN
  const alignX = clamp(target.x, MARGIN, maxX)
  const alignY = clamp(target.y, minY, maxY)
  const candidates: Placement[] = [
    { mode: 'beside', side: 'below', x: alignX, y: target.y + target.height + GAP },
    { mode: 'beside', side: 'above', x: alignX, y: target.y - GAP - card.height },
    { mode: 'beside', side: 'right', x: target.x + target.width + GAP, y: alignY },
    { mode: 'beside', side: 'left', x: target.x - GAP - card.width, y: alignY },
  ]
  for (const c of candidates) {
    if (c.mode !== 'beside') continue
    const box = { x: c.x, y: c.y, width: card.width, height: card.height }
    const inside = box.x >= MARGIN && box.y >= minY && box.x + box.width <= view.width - MARGIN && box.y + box.height <= view.height - MARGIN
    if (inside && !overlaps(box, target)) return c
  }
  return { mode: 'dock' }
}

// How far to scroll (positive = down the page) so the target is in view: its top below the app bars. When the card will dock at the
// bottom the target is always lifted to just under the app bars, so as much of it as possible shows above the card. Zero when it already is.
export function scrollDelta(target: Box, view: { height: number }, docked: boolean): number {
  const lowest = view.height - MARGIN
  if (docked) return Math.abs(target.y - TOP_CLEARANCE) < 1 ? 0 : target.y - TOP_CLEARANCE
  if (target.y < TOP_CLEARANCE) return target.y - TOP_CLEARANCE
  if (target.y > lowest || target.y + Math.min(target.height, 48) > lowest) return target.y - TOP_CLEARANCE
  return 0
}
