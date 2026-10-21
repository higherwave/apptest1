import { useEffect, useState } from 'react'

// Reveals freshly drafted text a little at a time, as the prototype does, so a new step reads as if it were being
// written. Text that is not new is shown whole. `done` turns true once everything is visible.
export function useTypedText(text: string, animate: boolean) {
  const [count, setCount] = useState(animate ? 0 : text.length)
  useEffect(() => {
    if (!animate) {
      setCount(text.length)
      return
    }
    setCount(0)
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
  return { shown: text.slice(0, count), done: count >= text.length }
}
