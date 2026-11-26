import { createContext, useContext } from 'react'
import type { PeekTarget } from './targets'

// The one quick-reference drawer: any link can ask for it. Without a provider (a test, say) it does nothing.
export type Peek = { open: (target: PeekTarget) => void; close: () => void }
export const PeekContext = createContext<Peek>({ open: () => {}, close: () => {} })
export const usePeek = () => useContext(PeekContext)
