// The apps' marks in one colour, for the dark header (the full-colour icons are used in the launcher). Drawn from the same strokes as the icon set:
// Signal Flow is five vertical bars, Pulse is a heartbeat line. They take the colour of the text around them.
import type { AppKey } from './apps'

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 2.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export function AppMark({ app, size = 28 }: { app: AppKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      {app === 'pulse' ? (
        <>
          <path {...line} d="M2.5 13h3.5l2-4" />
          <path {...line} d="M8 9l3.5 10 3-14" />
          <path {...line} d="M14.5 5l2 8h5" />
        </>
      ) : (
        <>
          <path {...line} d="M4 10v4 M8 7v10" />
          <path {...line} d="M12 3.5v17" />
          <path {...line} d="M16 7v10 M20 10v4" />
        </>
      )}
    </svg>
  )
}

/** The launcher's nine dots (3 by 3), as in the prototype. */
export function LauncherDots({ size = 20 }: { size?: number }) {
  const at = [0, 8, 16]
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden focusable="false">
      {at.flatMap((y) => at.map((x) => <rect key={`${x}-${y}`} x={x} y={y} width={4} height={4} rx={1} fill="currentColor" />))}
    </svg>
  )
}
