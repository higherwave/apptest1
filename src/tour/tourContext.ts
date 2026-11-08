import { createContext, useContext } from 'react'

export type TourApi = {
  /** Opens the welcome screen, where a tour is picked. */
  openWelcome: () => void
  /** Whether a tour is running (the welcome screen does not count). */
  running: boolean
}

export const TourContext = createContext<TourApi>({ openWelcome: () => {}, running: false })
export const useTour = () => useContext(TourContext)
