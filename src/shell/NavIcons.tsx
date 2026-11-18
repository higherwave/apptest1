// Two menu icons for the links that leave the app, drawn to sit with the Carbon line icons beside them: a 32 by 32 grid, round line ends, a 2 unit stroke, nothing filled
// but the play arrow. They take the colour of the text around them.
type IconProps = { size?: number }

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/** The prototype gallery: a bare browser window with a play button over its corner. */
export function PrototypeIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <path {...line} d="M27 17V8a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3v15a3 3 0 0 0 3 3h11" />
      <path {...line} d="M3 11h24" />
      <circle cx="7" cy="8" r="1" fill="currentColor" />
      <circle cx="10.5" cy="8" r="1" fill="currentColor" />
      <circle cx="14" cy="8" r="1" fill="currentColor" />
      <circle {...line} cx="24" cy="24" r="5.5" />
      <path d="M22.4 21.6l4.4 2.4-4.4 2.4z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
    </svg>
  )
}

/** The decision guides: a flowchart with one question and two outcomes. */
export function DecisionGuideIcon({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <rect {...line} x="11" y="3.5" width="10" height="6" rx="1.5" />
      <path {...line} d="M16 9.5v3.5" />
      <path {...line} d="M16 13l6.5 4.75L16 22.5l-6.5-4.75z" />
      <path {...line} d="M9.5 17.75H8a1.5 1.5 0 0 0-1.5 1.5V24M22.5 17.75H24a1.5 1.5 0 0 1 1.5 1.5V24" />
      <rect {...line} x="2.5" y="24" width="8" height="5" rx="1.5" />
      <rect {...line} x="21.5" y="24" width="8" height="5" rx="1.5" />
    </svg>
  )
}
