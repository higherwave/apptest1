import { useEffect, useState } from 'react'

// Reveals freshly drafted text a little at a time, as the prototype does, so a new step reads as if it were being
// written. Text that is not new is shown whole. `done` turns true once everything is visible.
export function useTypedText(text: string, animate: boolean) {
  const [count, setCount] = useState(0)
  // New text (or a change of mode) starts the reveal again from the beginning.
  const [seen, setSeen] = useState({ text, animate })
  if (seen.text !== text || seen.animate !== animate) {
    setSeen({ text, animate })
    setCount(0)
  }
  useEffect(() => {
    if (!animate) return
    const id = setInterval(() => {
      setCount((c) => {
        if (c + 12 >= text.length) {
          clearInterval(id)
          return text.length
        }
        return c + 12
      })
    }, 30)
    return () => clearInterval(id)
  }, [text, animate])
  const visible = animate ? Math.min(count, text.length) : text.length
  return { shown: text.slice(0, visible), done: visible >= text.length }
}
